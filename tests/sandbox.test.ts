import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { openDatabase, one, type Database } from '../backend/db.js';
import { getConfig } from '../backend/config.js';
import { createApp } from '../backend/app.js';
import { PayPal } from '../backend/paypal.js';
import { Auth } from '../backend/auth.js';
import { VaultService } from '../backend/service.js';

const config = { ...getConfig(), production: false, databaseUrl: '', localPath: ':memory:', origin: 'http://127.0.0.1:5173', paymentMode: 'sandbox' as const, demoEnabled: true, paypalClientId: 'test-client', paypalSecret: 'test-secret', paypalMerchantId: 'TEST-MERCHANT', paypalWebhookId: 'TEST-WEBHOOK' };
let db: Database;
before(async () => { db = await openDatabase(config); });
after(async () => { await db.close(); });

test('Sandbox starter is atomic and idempotent; one $1 task still requires approval', async () => {
  const auth = new Auth(db, config), service = new VaultService(db, config);
  const user = await auth.createUser(`${randomUUID()}@test.invalid`, 'Sandbox owner', 'test-only-password');
  const setups = await Promise.all(Array.from({ length: 8 }, () => service.setupSandbox(user)));
  assert.equal(new Set(setups.map(s => s.expenseId)).size, 1);
  const overview = await service.overview(user);
  assert.equal(overview.agents.length, 1); assert.equal(overview.expenses.length, 1);
  assert.equal(overview.agents[0].policy.maxTransaction, 100);
  assert.equal(overview.agents[0].policy.approvalAbove, 0);
  assert.equal(overview.expenses[0].maxUnits, 1);
  const { agentId, expenseId } = setups[0];
  const proposals = await Promise.all(Array.from({ length: 8 }, () => service.propose(user, agentId, expenseId, `sandbox-setup-${expenseId}`)));
  assert.equal(new Set(proposals.map(p => p.id)).size, 1);
  assert.equal(proposals[0].simulated, false); assert.equal(proposals[0].state, 'AWAITING_APPROVAL');
  assert.equal((await service.propose(user, agentId, expenseId, randomUUID())).state, 'BLOCKED');
  const demo = await auth.createUser(`${randomUUID()}@test.invalid`, 'Demo owner', 'test-only-password', true);
  await assert.rejects(service.setupSandbox(demo), /always use simulation/);
  const paused = await auth.createUser(`${randomUUID()}@test.invalid`, 'Paused owner', 'test-only-password');
  await service.setPaused(paused, true);
  const pausedSetup = await service.setupSandbox(paused);
  assert.equal((await service.propose(paused, pausedSetup.agentId, pausedSetup.expenseId, randomUUID())).state, 'BLOCKED');
});

test('Sandbox HTTP flow creates a provider order, requires buyer approval, captures once and verifies webhooks', async () => {
  const orders = new Map<string, any>(); let creates = 0, captures = 0, verified = 0;
  const paypal = new PayPal(config, (async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body).startsWith('{') ? String(init.body) : '{}') : {};
    if (path === '/v1/oauth2/token') return Response.json({ access_token: 'test-token', expires_in: 3600 });
    if (path === '/v1/notifications/verify-webhook-signature') {
      assert.equal(body.webhook_id, config.paypalWebhookId); verified++;
      return Response.json({ verification_status: 'SUCCESS' });
    }
    if (path === '/v2/checkout/orders') {
      creates++; assert.ok((init!.headers as Record<string, string>)['PayPal-Request-Id']);
      assert.equal(body.purchase_units[0].amount.value, '1.00');
      const id = randomUUID(); orders.set(id, { id, status: 'PAYER_ACTION_REQUIRED', purchase_units: body.purchase_units });
      return Response.json({ id, links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] });
    }
    const id = path.split('/')[4], order = orders.get(id);
    assert.ok(order, `Unexpected provider call ${path}`);
    if (path.endsWith('/capture')) {
      captures++; assert.ok((init!.headers as Record<string, string>)['PayPal-Request-Id']);
      order.status = 'COMPLETED'; order.purchase_units[0].payments = { captures: [{ id: 'CAPTURE-ONE', status: 'COMPLETED', amount: { currency_code: 'USD', value: '1.00' } }] };
    }
    return Response.json(order);
  }) as typeof fetch);
  const app = createApp(db, config, paypal), client = request.agent(app);
  const registered = await client.post('/api/auth/register').set('Origin', config.origin).send({ name: 'Sandbox tester', email: `${randomUUID()}@test.invalid`, password: 'test-only-password' }).expect(201);
  const post = (path: string, body = {}) => client.post('/api' + path).set('Origin', config.origin).set('X-CSRF-Token', registered.body.csrf).send(body);
  const starter = (await post('/integrations/paypal/setup').expect(200)).body;
  assert.equal(starter.simulated, false); assert.equal(starter.state, 'AWAITING_APPROVAL');
  assert.equal((await post('/integrations/paypal/setup').expect(200)).body.id, starter.id);
  await post(`/requests/${starter.id}/checkout`).expect(409);
  await post(`/requests/${starter.id}/decision`, { approve: true }).expect(200);
  const checkout = (await post(`/requests/${starter.id}/checkout`).expect(200)).body;
  assert.equal(checkout.request.state, 'AWAITING_PAYER'); assert.match(checkout.approvalUrl, /sandbox.paypal.com/);
  await post(`/requests/${starter.id}/checkout`).expect(200); assert.equal(creates, 1);
  await post(`/requests/${starter.id}/capture`).expect(409); assert.equal(captures, 0);
  orders.get(checkout.request.orderId).status = 'APPROVED';
  assert.equal((await post(`/requests/${starter.id}/capture`).expect(200)).body.state, 'COMPLETED');
  await post(`/requests/${starter.id}/capture`).expect(200); assert.equal(captures, 1);
  const event = { id: randomUUID(), event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { supplementary_data: { related_ids: { order_id: checkout.request.orderId } } } };
  await client.post('/api/webhooks/paypal').send(event).expect(400);
  for (let i = 0; i < 2; i++) await client.post('/api/webhooks/paypal').set({ 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.sandbox.paypal.com/cert', 'paypal-transmission-id': 'test-transmission', 'paypal-transmission-sig': 'test-signature', 'paypal-transmission-time': new Date().toISOString() }).send(event).expect(200);
  assert.equal(verified, 2);
  const overview = (await client.get('/api/overview').expect(200)).body;
  assert.equal(overview.totals.spent, 100); assert.equal(overview.totals.reserved, 0);
  assert.equal((await one(db, "SELECT count(*)::int AS n FROM agentvault.ledger WHERE request_id=$1 AND kind='settle'", [starter.id]))!.n, 1);
});
