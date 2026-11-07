import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { resolve } from 'node:path';
import type { Database } from './db.js';
import { one } from './db.js';
import type { Config } from './config.js';
import { Auth, passwordMatches, type AuthRequest } from './auth.js';
import { VaultService, hash, mapRequest, mapUser, now } from './service.js';
import { agentSchema, policySchema, expenseSchema, requestSchema, cents, AppError } from './validation.js';
import { PayPal } from './paypal.js';
import { plan } from './planner.js';

export function publicConfig(config: Config) {
  return { demoEnabled: config.demoEnabled, paymentMode: config.paymentMode, planner: config.geminiKey ? 'gemini' : 'local' };
}
export function createApp(db: Database, config: Config, paypal = new PayPal(config)) {
  const app = express(); const auth = new Auth(db, config); const service = new VaultService(db, config);
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: config.production ? { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], fontSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameAncestors: ["'none'"] } } : false, crossOriginEmbedderPolicy: false }));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '32kb' })); app.use(cookieParser());
  app.get('/api/config', (_req, res) => res.json(publicConfig(config)));
  app.get('/api/health', async (_req, res) => { await db.query('SELECT 1'); res.json({ status: 'ok', database: 'postgres', paymentMode: config.paymentMode }); });
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path === '/webhooks/paypal' || req.path.startsWith('/agent/')) return next();
    const allowed = new Set([config.origin]);
    if (process.env.VERCEL_URL) allowed.add(`https://${process.env.VERCEL_URL}`);
    if (!req.headers.origin || !allowed.has(req.headers.origin)) throw new AppError(403, 'This request must come from the AgentVault application.');
    next();
  });
  const credentials = z.object({ email: z.email().max(254).transform(x => x.toLowerCase()), password: z.string().min(10).max(128) });
  app.post('/api/auth/register', auth.limit('signup', 6, 3600000), async (req, res) => {
    const data = credentials.extend({ name: z.string().trim().min(2).max(60) }).strict().parse(req.body);
    const id = await auth.createUser(data.email, data.name, data.password);
    const csrf = await auth.session(res, id, req.cookies[auth.cookieName]); res.status(201).json({ csrf });
  });
  app.post('/api/auth/login', auth.limit('login', 15, 900000), async (req, res) => {
    const input = credentials.strict().parse(req.body);
    const user = await one(db, 'SELECT * FROM agentvault.users WHERE email=$1 AND is_demo=false', [input.email]);
    if (!await passwordMatches(input.password, user?.password_hash || '') || !user) throw new AppError(401, 'Email or password is incorrect.');
    const csrf = await auth.session(res, user.id, req.cookies[auth.cookieName]); res.json({ csrf });
  });
  app.post('/api/auth/demo', auth.limit('demo', 10, 3600000), async (req, res) => {
    if (!config.demoEnabled) throw new AppError(404, 'Demo sessions are disabled.');
    const id = await auth.createUser(`demo-${randomUUID()}@agentvault.invalid`, 'Alex Morgan', randomBytes(32).toString('hex'), true);
    await service.seed(id); const csrf = await auth.session(res, id, req.cookies[auth.cookieName]); res.status(201).json({ csrf });
  });
  app.get('/api/auth/me', auth.require, async (req: AuthRequest, res) => { const user = await one(db, 'SELECT * FROM agentvault.users WHERE id=$1', [req.userId]); res.json({ user: mapUser(user), csrf: req.csrf }); });
  app.post('/api/auth/logout', auth.require, async (req, res) => { await db.query('DELETE FROM agentvault.sessions WHERE token_hash=$1', [hash(req.cookies[auth.cookieName])]); res.clearCookie(auth.cookieName, { path: '/', httpOnly: true, secure: config.production, sameSite: 'lax' }); res.json({ ok: true }); });

  // The externally issued agent token has no access to owner configuration or approval routes.
  app.get('/api/agent/tasks', auth.agent, async (req: AuthRequest, res) => res.json((await db.query('SELECT id,title,amount_cents,payee_id,max_units,cadence FROM agentvault.expenses WHERE user_id=$1 AND agent_id=$2 AND active=true', [req.userId, req.agentId])).rows));
  app.post('/api/agent/requests', auth.agent, auth.limit('agent-request', 120, 60000, true), async (req: AuthRequest, res) => {
    const data = requestSchema.parse(req.body); res.json(await service.propose(req.userId!, req.agentId!, data.expenseId, data.clientKey));
  });

  app.post('/api/webhooks/paypal', async (req, res) => {
    await paypal.verifyWebhook(req.headers, req.body);
    const event = z.object({ id: z.string().min(1).max(100), event_type: z.string().max(100), resource: z.any() }).parse(req.body);
    if (await one(db, 'SELECT id FROM agentvault.webhooks WHERE id=$1', [event.id])) return res.json({ received: true });
    const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
    if (typeof orderId === 'string') {
      const r = await one(db, 'SELECT * FROM agentvault.requests WHERE order_id=$1 AND simulated=false', [orderId]);
      if (r && ['CAPTURING', 'RECONCILING', 'COMPLETED'].includes(r.state)) {
        const order = await paypal.get(orderId); const capture = paypal.validate(order, r);
        if (capture) await service.settle(r.user_id, r.id, capture);
      }
    }
    await db.query('INSERT INTO agentvault.webhooks VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [event.id, now(), event.event_type]);
    res.json({ received: true });
  });

  const owner = express.Router(); owner.use(auth.require); owner.use(auth.limit('owner', 240, 60000, true));
  owner.get('/overview', async (req: AuthRequest, res) => res.json(await service.overview(req.userId!)));
  owner.post('/agents', async (req: AuthRequest, res) => res.status(201).json(await service.createAgent(req.userId!, agentSchema.parse(req.body))));
  owner.put('/agents/:id/policy', async (req: AuthRequest, res) => res.json(await service.updatePolicy(req.userId!, String(req.params.id), policySchema.parse(req.body))));
  owner.patch('/agents/:id/status', async (req: AuthRequest, res) => {
    const { status } = z.object({ status: z.enum(['active', 'paused', 'revoked']) }).strict().parse(req.body);
    await service.setAgentStatus(req.userId!, String(req.params.id), status); res.json({ ok: true });
  });
  owner.post('/agents/:id/token', async (req: AuthRequest, res) => {
    const token = `av_${randomBytes(32).toString('hex')}`;
    await service.locked(req.userId!, async tx => {
      const agent = await service.agent(tx, req.userId!, String(req.params.id));
      if (agent.status !== 'active') throw new AppError(409, 'Enable the agent before issuing a token.');
      await tx.query('UPDATE agentvault.agents SET token_hash=$2 WHERE id=$1', [agent.id, hash(token)]);
      await service.audit(tx, req.userId!, 'token.rotated', agent.id, 'New scoped agent token issued; previous token invalidated.');
    }); res.json({ token });
  });
  owner.patch('/vault', async (req: AuthRequest, res) => { const input = z.object({ budgetCents: cents }).strict().parse(req.body); await service.setBudget(req.userId!, input.budgetCents); res.json({ ok: true }); });
  owner.post('/vault/pause', async (req: AuthRequest, res) => { const input = z.object({ paused: z.boolean() }).strict().parse(req.body); await service.setPaused(req.userId!, input.paused); res.json({ ok: true }); });
  owner.post('/expenses', async (req: AuthRequest, res) => res.status(201).json(await service.createExpense(req.userId!, expenseSchema.parse(req.body))));
  owner.patch('/expenses/:id', async (req: AuthRequest, res) => { const { active } = z.object({ active: z.boolean() }).strict().parse(req.body); await service.toggleExpense(req.userId!, String(req.params.id), active); res.json({ ok: true }); });
  owner.post('/agents/:id/requests', async (req: AuthRequest, res) => { const data = requestSchema.parse(req.body); res.json(await service.propose(req.userId!, String(req.params.id), data.expenseId, data.clientKey)); });
  owner.post('/agents/:id/plan', auth.limit('planner', 15, 60000, true), async (req: AuthRequest, res) => {
    const { prompt } = z.object({ prompt: z.string().trim().min(3).max(1500) }).strict().parse(req.body);
    await service.agent(db, req.userId!, String(req.params.id));
    const user = await one(db, 'SELECT * FROM agentvault.users WHERE id=$1', [req.userId]);
    const expenses = (await db.query('SELECT * FROM agentvault.expenses WHERE user_id=$1 AND agent_id=$2', [req.userId, req.params.id])).rows;
    res.json(await plan(config, prompt, expenses, user!.is_demo));
  });
  owner.post('/agents/:id/test-policy', async (req: AuthRequest, res) => {
    const data = z.object({ policy: policySchema, amountCents: cents.min(1), payeeId: z.string().max(80) }).strict().parse(req.body);
    const result = await service.locked(req.userId!, async (tx, user) => {
      const agent = await service.agent(tx, req.userId!, String(req.params.id));
      return service.evaluate(tx, user, { ...agent, policy: data.policy }, { id: 'preview', payee_id: data.payeeId, amount_cents: data.amountCents, cadence: 'once', max_units: 1, active: true, due_at: now() });
    }); res.json(result);
  });
  owner.post('/requests/:id/decision', async (req: AuthRequest, res) => { const { approve } = z.object({ approve: z.boolean() }).strict().parse(req.body); res.json(await service.decide(req.userId!, String(req.params.id), approve)); });
  owner.post('/requests/:id/cancel', async (req: AuthRequest, res) => { await service.cancel(req.userId!, String(req.params.id)); res.json({ ok: true }); });
  owner.post('/requests/:id/checkout', async (req: AuthRequest, res) => {
    const id = String(req.params.id); const original = await service.request(db, req.userId!, id);
    if (!original.simulated) await paypal.token(); // Fail before changing state if credentials/auth are unavailable.
    const { request: r, already } = await service.authorizeExecution(req.userId!, id, 'create');
    if (already) return res.json({ approvalUrl: r!.approval_url, simulated: r!.simulated, request: mapRequest(r) });
    try {
      const order = r!.simulated ? { id: `SIM-${randomUUID()}`, approvalUrl: null } : await paypal.create(r);
      await service.orderCreated(req.userId!, id, order.id, order.approvalUrl);
      res.json({ approvalUrl: order.approvalUrl, simulated: r!.simulated, request: mapRequest(await service.request(db, req.userId!, id)) });
    } catch (error) { await service.uncertain(req.userId!, id); throw error; }
  });
  owner.post('/requests/:id/capture', async (req: AuthRequest, res) => {
    const id = String(req.params.id); const original = await service.request(db, req.userId!, id);
    if (!original.simulated && original.state !== 'COMPLETED') {
      const order = await paypal.get(original.order_id); paypal.validate(order, original);
      if (order.status !== 'APPROVED') throw new AppError(409, 'Complete buyer approval in PayPal before capturing payment.');
    }
    const { request: r, already } = await service.authorizeExecution(req.userId!, id, 'capture');
    if (already) return res.json(mapRequest(r));
    try {
      let capture: string | undefined;
      if (r!.simulated) capture = `SIM-${randomUUID()}`;
      else { await paypal.capture(r); capture = paypal.validate(await paypal.get(r!.order_id), r); }
      if (!capture) { await service.uncertain(req.userId!, id); throw new AppError(409, 'Capture is pending. Check status shortly.'); }
      await service.settle(req.userId!, id, capture); res.json(mapRequest(await service.request(db, req.userId!, id)));
    } catch (error) { await service.uncertain(req.userId!, id); throw error; }
  });
  owner.post('/requests/:id/reconcile', async (req: AuthRequest, res) => {
    const id = String(req.params.id); const r = await service.request(db, req.userId!, id);
    if (r.state === 'COMPLETED') return res.json(mapRequest(r));
    if (!['CREATING', 'CAPTURING', 'RECONCILING', 'AWAITING_PAYER'].includes(r.state)) throw new AppError(409, 'This request has no provider result to reconcile.');
    if (['CREATING', 'CAPTURING'].includes(r.state) && Date.now() - Date.parse(r.operation_started_at) < 30000) throw new AppError(409, 'Payment is still in progress. Wait 30 seconds before checking.');
    if (r.simulated) throw new AppError(409, 'No external provider is involved in this simulated request.');
    if (!r.order_id) throw new AppError(409, 'Order creation is uncertain. Keep the reservation and use the recorded request ID for provider reconciliation; do not submit another payment.');
    const order = await paypal.get(r.order_id); const capture = paypal.validate(order, r);
    if (capture && ['CAPTURING', 'RECONCILING'].includes(r.state)) { await service.settle(req.userId!, id, capture); }
    else if (!capture) throw new AppError(409, `PayPal reports ${order.status || 'pending'}. Funds remain reserved. No new charge was attempted.`);
    res.json(mapRequest(await service.request(db, req.userId!, id)));
  });
  owner.post('/integrations/paypal/test', async (_req, res) => { await paypal.token(); res.json({ ok: true, message: 'PayPal Sandbox authentication verified.' }); });
  owner.post('/integrations/paypal/setup', async (req: AuthRequest, res) => {
    if (config.paymentMode !== 'sandbox' || !paypal.configured()) throw new AppError(503, 'PayPal Sandbox is not configured on the server.');
    await paypal.token();
    const setup = await service.setupSandbox(req.userId!);
    res.json(await service.propose(req.userId!, setup.agentId, setup.expenseId, `sandbox-setup-${setup.expenseId}`));
  });
  owner.post('/demo/burst', auth.limit('burst', 3, 3600000, true), async (req: AuthRequest, res) => {
    const user = await one(db, 'SELECT * FROM agentvault.users WHERE id=$1', [req.userId]);
    if (!user!.is_demo) throw new AppError(403, 'Run this simulation in a demo workspace.');
    const row = await one(db, "SELECT * FROM agentvault.expenses WHERE user_id=$1 AND payee_id='video' AND cadence='once' ORDER BY created_at LIMIT 1", [req.userId]);
    if (!row) throw new AppError(404, 'Demo video task not found.');
    const results = await Promise.all(Array.from({ length: 500 }, () => service.propose(req.userId!, row.agent_id, row.id, randomUUID())));
    res.json({ attempts: 500, allowed: results.filter(r => r.state === 'READY').length, blocked: results.filter(r => r.state === 'BLOCKED').length, reservedCents: results.filter(r => r.state === 'READY').reduce((n, r) => n + r.amountCents, 0) });
  });
  app.use('/api', owner);
  app.use('/api', (_req, _res) => { throw new AppError(404, 'API route not found.'); });
  if (!process.env.VERCEL) { app.use(express.static(resolve('dist'))); app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html'))); }
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(' ') });
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    console.error('AgentVault request failed:', error.code || error.name || 'unknown');
    res.status(500).json({ error: 'The request could not be completed. Please refresh and try again.' });
  });
  return app;
}
