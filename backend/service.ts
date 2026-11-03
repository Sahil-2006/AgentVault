import { randomUUID, createHash } from 'node:crypto';
import type { Agent, Expense, PaymentRequest, Policy, User, Payee } from '../shared/types.js';
import type { Database, Queryable } from './db.js';
import { one } from './db.js';
import { AppError } from './validation.js';
import { evaluatePolicy } from './policy.js';
import type { Config } from './config.js';

export const payees: Payee[] = [
  { id: 'electric', name: 'Electric Co.', category: 'Utilities' }, { id: 'internet', name: 'Fiber Internet', category: 'Utilities' },
  { id: 'streamly', name: 'Streamly', category: 'Subscriptions' }, { id: 'video', name: 'Frame Studio', category: 'Video generation' },
  { id: 'research', name: 'Research API', category: 'API services' },
];
export const defaultPolicy = (): Policy => ({ maxTransaction: 30000, approvalAbove: 15000, dailyLimit: 40000, monthlyLimit: 80000, allowedPayees: ['electric', 'internet'], frequency: 'monthly', expiresAt: new Date(Date.now() + 90 * 86400000).toISOString() });
export const now = () => new Date().toISOString();
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const reserved = ['READY', 'CREATING', 'AWAITING_PAYER', 'CAPTURING', 'RECONCILING'];
const obligations = [...reserved, 'COMPLETED'];
const taskStates = [...obligations, 'AWAITING_APPROVAL'];
const removable = ['READY', 'AWAITING_APPROVAL', 'AWAITING_PAYER'];
export const mapUser = (r: any): User => ({ id: r.id, name: r.name, email: r.email, budgetCents: r.budget_cents, paused: r.paused, isDemo: r.is_demo });
export const mapAgent = (r: any): Agent => ({ id: r.id, name: r.name, purpose: r.purpose, status: r.status, policy: r.policy, policyVersion: r.policy_version, hasToken: !!r.token_hash });
export const mapExpense = (r: any): Expense => ({ id: r.id, agentId: r.agent_id, payeeId: r.payee_id, title: r.title, amountCents: r.amount_cents, cadence: r.cadence, maxUnits: r.max_units, active: r.active, dueAt: r.due_at });
export const mapRequest = (r: any): PaymentRequest => ({ id: r.id, agentId: r.agent_id, expenseId: r.expense_id, agentName: r.agent_name || '', payeeId: r.payee_id, payeeName: payees.find(p => p.id === r.payee_id)?.name || 'Unknown payee', title: r.title, amountCents: r.amount_cents, currency: r.currency, state: r.state, decision: r.decision, reason: r.reason, createdAt: r.created_at, updatedAt: r.updated_at, policyVersion: r.policy_version, orderId: r.order_id, captureId: r.capture_id, simulated: r.simulated, approvedAt: r.approved_at, checks: r.checks });
export class VaultService {
  constructor(public db: Database, public config: Config) {}
  async locked<T>(userId: string, fn: (tx: Queryable, user: any) => Promise<T>) {
    return this.db.transaction(async tx => {
      const user = await one(tx, 'SELECT * FROM agentvault.users WHERE id=$1 FOR UPDATE', [userId]);
      if (!user) throw new AppError(401, 'Please sign in.');
      return fn(tx, user);
    });
  }
  async audit(tx: Queryable, user: string, action: string, subject: string, detail: string) {
    await tx.query('INSERT INTO agentvault.audit VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), user, action, subject, detail, now()]);
  }
  async ledger(tx: Queryable, user: string, request: string, kind: string, amount: number) {
    await tx.query('INSERT INTO agentvault.ledger VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(request_id,kind) DO NOTHING', [randomUUID(), user, request, kind, amount, now()]);
  }
  async agent(tx: Queryable, user: string, id: string) {
    const row = await one(tx, 'SELECT * FROM agentvault.agents WHERE id=$1 AND user_id=$2', [id, user]);
    if (!row) throw new AppError(404, 'Agent not found.'); return row;
  }
  async request(tx: Queryable, user: string, id: string) {
    const row = await one(tx, 'SELECT r.*, a.name AS agent_name FROM agentvault.requests r JOIN agentvault.agents a ON a.id=r.agent_id WHERE r.id=$1 AND r.user_id=$2', [id, user]);
    if (!row) throw new AppError(404, 'Request not found.'); return row;
  }
  async totals(tx: Queryable, user: any) {
    const rows = (await tx.query('SELECT state,amount_cents,created_at,updated_at FROM agentvault.requests WHERE user_id=$1', [user.id])).rows;
    const spent = rows.filter(r => r.state === 'COMPLETED').reduce((n, r) => n + r.amount_cents, 0);
    const held = rows.filter(r => reserved.includes(r.state)).reduce((n, r) => n + r.amount_cents, 0);
    return { spent, reserved: held, available: user.budget_cents - spent - held, monthSpent: rows.filter(r => r.state === 'COMPLETED' && r.updated_at.slice(0, 7) === now().slice(0, 7)).reduce((n, r) => n + r.amount_cents, 0), approvals: rows.filter(r => r.state === 'AWAITING_APPROVAL').length };
  }
  async overview(userId: string) {
    return this.locked(userId, async (tx, user) => {
      const agents = (await tx.query('SELECT * FROM agentvault.agents WHERE user_id=$1 ORDER BY created_at', [userId])).rows.map(mapAgent);
      const expenses = (await tx.query('SELECT * FROM agentvault.expenses WHERE user_id=$1 ORDER BY created_at', [userId])).rows.map(mapExpense);
      // Keep actionable requests visible even after a burst of rejected proposals.
      const requests = (await tx.query('SELECT r.*, a.name AS agent_name FROM agentvault.requests r JOIN agentvault.agents a ON a.id=r.agent_id WHERE r.user_id=$1 AND (r.state=ANY($2::text[]) OR r.id IN (SELECT id FROM agentvault.requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 250)) ORDER BY r.created_at DESC', [userId, [...reserved, 'AWAITING_APPROVAL']])).rows.map(mapRequest);
      const events = (await tx.query('SELECT * FROM agentvault.audit WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [userId])).rows.map(r => ({ id: r.id, action: r.action, subjectId: r.subject_id, detail: r.detail, createdAt: r.created_at }));
      return { user: mapUser(user), agents, expenses, requests, events, payees, totals: { ...await this.totals(tx, user), activeAgents: user.paused ? 0 : agents.filter(a => a.status === 'active').length }, integration: { paymentMode: user.is_demo ? 'simulation' : this.config.paymentMode, paypalConfigured: !!(this.config.paypalClientId && this.config.paypalSecret && this.config.paypalMerchantId), webhookConfigured: !!this.config.paypalWebhookId, planner: this.config.geminiKey && !user.is_demo ? 'gemini' : 'local' } };
    });
  }
  async createAgent(userId: string, input: { name: string; purpose: string; policy: Policy }) {
    return this.locked(userId, async (tx) => {
      const count = await one(tx, 'SELECT count(*)::int AS n FROM agentvault.agents WHERE user_id=$1', [userId]);
      if (count!.n >= 20) throw new AppError(400, 'This workspace supports up to 20 agents.');
      const id = randomUUID();
      await tx.query('INSERT INTO agentvault.agents(id,user_id,name,purpose,policy,created_at) VALUES($1,$2,$3,$4,$5,$6)', [id, userId, input.name, input.purpose, JSON.stringify(input.policy), now()]);
      await this.audit(tx, userId, 'agent.created', id, `${input.name} registered with scoped permissions.`);
      return mapAgent(await this.agent(tx, userId, id));
    });
  }
  async cancelPending(tx: Queryable, userId: string, agentId: string | null, reason: string) {
    const rows = (await tx.query('SELECT * FROM agentvault.requests WHERE user_id=$1 AND ($2::text IS NULL OR agent_id=$2) AND state=ANY($3::text[])', [userId, agentId, removable])).rows;
    for (const r of rows) {
      await tx.query("UPDATE agentvault.requests SET state='CANCELED',reason=$2,updated_at=$3 WHERE id=$1", [r.id, reason, now()]);
      if (reserved.includes(r.state)) await this.ledger(tx, userId, r.id, 'release', r.amount_cents);
      await this.audit(tx, userId, 'request.canceled', r.id, reason);
    }
  }
  async updatePolicy(userId: string, agentId: string, policy: Policy) {
    return this.locked(userId, async tx => {
      const agent = await this.agent(tx, userId, agentId);
      await tx.query("UPDATE agentvault.agents SET policy=$2,policy_version=policy_version+1,status=CASE WHEN status='revoked' THEN 'paused' ELSE status END WHERE id=$1", [agentId, JSON.stringify(policy)]);
      await this.cancelPending(tx, userId, agentId, 'Permission changed. Submit a fresh request under the new policy.');
      await this.audit(tx, userId, 'policy.updated', agentId, `${agent.name}: permission version ${agent.policy_version + 1} saved.`);
      return mapAgent(await this.agent(tx, userId, agentId));
    });
  }
  async setAgentStatus(userId: string, agentId: string, status: string) {
    return this.locked(userId, async tx => {
      const agent = await this.agent(tx, userId, agentId);
      if (agent.status === 'revoked' && status === 'active') throw new AppError(409, 'Save a new permission before enabling a revoked agent.');
      await tx.query('UPDATE agentvault.agents SET status=$2,token_hash=CASE WHEN $2=\'revoked\' THEN NULL ELSE token_hash END WHERE id=$1', [agentId, status]);
      if (status !== 'active') await this.cancelPending(tx, userId, agentId, `Agent ${status}. Checkout disabled.`);
      await this.audit(tx, userId, `agent.${status}`, agentId, `${agent.name} is ${status}. In-flight payments will still be reconciled.`);
    });
  }
  async setPaused(userId: string, paused: boolean) {
    return this.locked(userId, async tx => {
      await tx.query('UPDATE agentvault.users SET paused=$2 WHERE id=$1', [userId, paused]);
      if (paused) await this.cancelPending(tx, userId, null, 'All agents paused. Submit a fresh request after resuming.');
      await this.audit(tx, userId, paused ? 'vault.paused' : 'vault.resumed', userId, paused ? 'New payment actions stopped across every agent.' : 'Vault resumed. Individual paused/revoked agents stay disabled.');
    });
  }
  async setBudget(userId: string, cents: number) {
    return this.locked(userId, async (tx, user) => {
      const totals = await this.totals(tx, user);
      if (cents < totals.spent + totals.reserved) throw new AppError(400, 'Allocation cannot be lower than spent plus reserved funds.');
      await tx.query('UPDATE agentvault.users SET budget_cents=$2 WHERE id=$1', [userId, cents]);
      await this.audit(tx, userId, 'vault.allocated', userId, `Virtual allocation set to $${(cents / 100).toFixed(2)}. No money was deposited.`);
    });
  }
  async createExpense(userId: string, input: Omit<Expense, 'id' | 'active'>) {
    return this.locked(userId, async tx => {
      await this.agent(tx, userId, input.agentId);
      const count = await one(tx, 'SELECT count(*)::int AS n FROM agentvault.expenses WHERE user_id=$1', [userId]);
      if (count!.n >= 100) throw new AppError(400, 'This workspace supports up to 100 tasks.');
      const id = randomUUID();
      await tx.query('INSERT INTO agentvault.expenses(id,user_id,agent_id,payee_id,title,amount_cents,cadence,max_units,due_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [id, userId, input.agentId, input.payeeId, input.title, input.amountCents, input.cadence, input.maxUnits, input.dueAt, now()]);
      await this.audit(tx, userId, 'task.authorized', id, `${input.title}: up to ${input.maxUnits} operation(s) at $${(input.amountCents / 100).toFixed(2)} each.`);
      return mapExpense((await one(tx, 'SELECT * FROM agentvault.expenses WHERE id=$1', [id]))!);
    });
  }
  async toggleExpense(userId: string, id: string, active: boolean) {
    return this.locked(userId, async tx => {
      const expense = await one(tx, 'SELECT * FROM agentvault.expenses WHERE id=$1 AND user_id=$2', [id, userId]);
      if (!expense) throw new AppError(404, 'Task not found.');
      await tx.query('UPDATE agentvault.expenses SET active=$2 WHERE id=$1', [id, active]);
      await this.audit(tx, userId, active ? 'task.enabled' : 'task.disabled', id, expense.title);
    });
  }
  occurrence(expense: any) { return expense.cadence === 'once' ? 'once' : now().slice(0, expense.cadence === 'daily' ? 10 : 7); }
  async evaluate(tx: Queryable, user: any, agent: any, expense: any, exclude?: string) {
    const rows = (await tx.query('SELECT * FROM agentvault.requests WHERE user_id=$1 AND ($2::text IS NULL OR id<>$2)', [user.id, exclude || null])).rows;
    const committed = rows.filter(r => obligations.includes(r.state));
    const spent = committed.reduce((sum, r) => sum + r.amount_cents, 0);
    const day = now().slice(0, 10); const month = now().slice(0, 7);
    const own = committed.filter(r => r.agent_id === agent.id);
    // Outstanding reservations count against the current period even across midnight/month rollover.
    const period = (r: any, prefix: string) => reserved.includes(r.state) || r.updated_at.startsWith(prefix);
    return evaluatePolicy({ paused: user.paused, agentStatus: agent.status, policy: agent.policy, amount: expense.amount_cents, payee: expense.payee_id, available: user.budget_cents - spent,
      dayUsed: own.filter(r => period(r, day)).reduce((n, r) => n + r.amount_cents, 0), monthUsed: own.filter(r => period(r, month)).reduce((n, r) => n + r.amount_cents, 0),
      frequencyUsed: own.filter(r => r.payee_id === expense.payee_id && period(r, agent.policy.frequency === 'daily' ? day : month)).length,
      taskUsed: rows.filter(r => r.expense_id === expense.id && r.occurrence === this.occurrence(expense) && taskStates.includes(r.state)).length,
      maxUnits: expense.max_units, expenseActive: expense.active, dueAt: expense.due_at });
  }
  async propose(userId: string, agentId: string, expenseId: string, clientKey: string) {
    return this.locked(userId, async (tx, user) => {
      const previous = await one(tx, 'SELECT id,agent_id,expense_id FROM agentvault.requests WHERE user_id=$1 AND client_key=$2', [userId, clientKey]);
      if (previous) {
        if (previous.agent_id !== agentId || previous.expense_id !== expenseId) throw new AppError(409, 'Idempotency key already belongs to a different request.');
        return mapRequest(await this.request(tx, userId, previous.id));
      }
      const agent = await this.agent(tx, userId, agentId);
      const expense = await one(tx, 'SELECT * FROM agentvault.expenses WHERE id=$1 AND agent_id=$2 AND user_id=$3', [expenseId, agentId, userId]);
      if (!expense) throw new AppError(404, 'Authorized task not found for this agent.');
      const evaluation = await this.evaluate(tx, user, agent, expense);
      const id = randomUUID(); const state = evaluation.decision === 'DENY' ? 'BLOCKED' : evaluation.decision === 'REQUIRES_APPROVAL' ? 'AWAITING_APPROVAL' : 'READY';
      await tx.query(`INSERT INTO agentvault.requests(id,user_id,agent_id,expense_id,payee_id,title,amount_cents,state,decision,reason,checks,policy_version,occurrence,client_key,simulated,create_key,capture_key,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`,
      [id, userId, agentId, expenseId, expense.payee_id, expense.title, expense.amount_cents, state, evaluation.decision, evaluation.reason, JSON.stringify(evaluation.checks), agent.policy_version, this.occurrence(expense), clientKey, user.is_demo || this.config.paymentMode === 'simulation', randomUUID(), randomUUID(), now()]);
      if (state === 'READY') await this.ledger(tx, userId, id, 'reserve', expense.amount_cents);
      await this.audit(tx, userId, `payment.${state.toLowerCase()}`, id, `${agent.name} → ${expense.title}: ${evaluation.reason}`);
      return mapRequest(await this.request(tx, userId, id));
    });
  }
  async decide(userId: string, id: string, approve: boolean) {
    return this.locked(userId, async (tx, user) => {
      const r = await this.request(tx, userId, id);
      if (r.state !== 'AWAITING_APPROVAL') throw new AppError(409, 'This request is no longer waiting for approval.');
      let state = 'REJECTED'; let reason = 'Owner rejected this request.'; let checks = r.checks;
      if (approve) {
        const agent = await this.agent(tx, userId, r.agent_id);
        const expense = await one(tx, 'SELECT * FROM agentvault.expenses WHERE id=$1', [r.expense_id]);
        const ev = await this.evaluate(tx, user, agent, expense, id);
        checks = ev.checks;
        if (agent.policy_version !== r.policy_version || r.occurrence !== this.occurrence(expense) || Date.now() - Date.parse(r.created_at) > 86400000) { state = 'CANCELED'; reason = 'This approval expired or its policy changed. Submit a fresh request.'; }
        else if (ev.decision === 'DENY') { state = 'BLOCKED'; reason = ev.reason; }
        else { state = 'READY'; reason = 'Approved by the owner. Ready for checkout.'; await this.ledger(tx, userId, id, 'reserve', r.amount_cents); }
      }
      await tx.query('UPDATE agentvault.requests SET state=$2,reason=$3,approved_at=$4,updated_at=$5,checks=$6 WHERE id=$1', [id, state, reason, state === 'READY' ? now() : null, now(), JSON.stringify(checks)]);
      await this.audit(tx, userId, approve ? 'approval.reviewed' : 'approval.rejected', id, reason);
      return mapRequest(await this.request(tx, userId, id));
    });
  }
  async authorizeExecution(userId: string, id: string, operation: 'create' | 'capture') {
    const result = await this.locked(userId, async (tx, user) => {
      const r = await this.request(tx, userId, id);
      if (r.state === 'COMPLETED') return { request: r, already: true };
      if (operation === 'create' && r.state === 'AWAITING_PAYER') return { request: r, already: true };
      const expected = operation === 'create' ? 'READY' : 'AWAITING_PAYER';
      if (r.state !== expected) throw new AppError(409, `Payment is ${r.state.toLowerCase().replaceAll('_', ' ')}. Refresh its status before continuing.`);
      const agent = await this.agent(tx, userId, r.agent_id);
      const expense = await one(tx, 'SELECT * FROM agentvault.expenses WHERE id=$1', [r.expense_id]);
      const ev = await this.evaluate(tx, user, agent, expense, id);
      const staleApproval = r.approved_at && Date.now() - Date.parse(r.approved_at) > 86400000;
      if (ev.decision === 'DENY' || r.policy_version !== agent.policy_version || r.occurrence !== this.occurrence(expense) || staleApproval || (ev.decision === 'REQUIRES_APPROVAL' && !r.approved_at)) {
        const reason = ev.decision === 'DENY' ? ev.reason : 'Permission changed or approval expired. Submit a fresh request.';
        await tx.query("UPDATE agentvault.requests SET state='BLOCKED',reason=$2,updated_at=$3 WHERE id=$1", [id, reason, now()]);
        await this.ledger(tx, userId, id, 'release', r.amount_cents);
        await this.audit(tx, userId, 'execution.blocked', id, reason);
        return { error: reason };
      }
      // The row lock is the freeze/capture linearization point. In-flight calls may finish after a pause.
      await tx.query('UPDATE agentvault.requests SET state=$2,operation_started_at=$3,updated_at=$3 WHERE id=$1', [id, operation === 'create' ? 'CREATING' : 'CAPTURING', now()]);
      return { request: r, already: false };
    });
    if ('error' in result) throw new AppError(409, result.error!);
    return result;
  }
  async orderCreated(userId: string, id: string, orderId: string, approvalUrl: string | null) {
    return this.locked(userId, async tx => {
      const r = await this.request(tx, userId, id);
      if (r.state !== 'CREATING' && r.state !== 'RECONCILING') return;
      await tx.query("UPDATE agentvault.requests SET state='AWAITING_PAYER',order_id=$2,approval_url=$3,reason=$4,updated_at=$5 WHERE id=$1", [id, orderId, approvalUrl, r.simulated ? 'Simulation ready. Confirm to complete the test payment.' : 'Waiting for buyer approval in PayPal Sandbox.', now()]);
      await this.audit(tx, userId, 'checkout.created', id, r.simulated ? 'Simulated checkout created.' : `PayPal Sandbox order ${orderId} created.`);
    });
  }
  async settle(userId: string, id: string, captureId: string) {
    return this.locked(userId, async tx => {
      const r = await this.request(tx, userId, id);
      if (r.state === 'COMPLETED') return;
      if (!['CAPTURING', 'RECONCILING'].includes(r.state)) throw new AppError(409, 'Payment is not awaiting settlement.');
      await tx.query("UPDATE agentvault.requests SET state='COMPLETED',capture_id=$2,reason=$3,updated_at=$4 WHERE id=$1", [id, captureId, r.simulated ? 'Simulated payment completed. No money moved.' : 'Payment confirmed by PayPal Sandbox.', now()]);
      await this.ledger(tx, userId, id, 'settle', r.amount_cents);
      await this.audit(tx, userId, 'payment.completed', id, `${r.title}: $${(r.amount_cents / 100).toFixed(2)} ${r.simulated ? '(simulation)' : '(PayPal Sandbox)'}.`);
    });
  }
  async uncertain(userId: string, id: string) {
    return this.locked(userId, async tx => {
      const r = await this.request(tx, userId, id);
      if (!['CREATING', 'CAPTURING', 'RECONCILING'].includes(r.state)) return;
      await tx.query("UPDATE agentvault.requests SET state='RECONCILING',reason=$2,updated_at=$3 WHERE id=$1", [id, 'Provider outcome is not confirmed. Funds stay reserved; check status before retrying.', now()]);
      await this.audit(tx, userId, 'payment.reconciling', id, 'Uncertain provider response. No replacement payment will be created.');
    });
  }
  async cancel(userId: string, id: string) {
    return this.locked(userId, async tx => {
      const r = await this.request(tx, userId, id);
      if (!removable.includes(r.state)) throw new AppError(409, 'In-flight or finished payments cannot be canceled here. Reconcile their status.');
      await tx.query("UPDATE agentvault.requests SET state='CANCELED',reason='Canceled by owner. Further capture is disabled.',updated_at=$2 WHERE id=$1", [id, now()]);
      if (reserved.includes(r.state)) await this.ledger(tx, userId, id, 'release', r.amount_cents);
      await this.audit(tx, userId, 'payment.canceled', id, 'Canceled before capture. Virtual reservation released.');
    });
  }
  async seed(userId: string) {
    const bill = await this.createAgent(userId, { name: 'BillBot', purpose: 'Keeps the lights on. Handles your utility bills.', policy: defaultPolicy() });
    const sub = await this.createAgent(userId, { name: 'SubManager', purpose: 'Keeps recurring subscriptions within budget.', policy: { ...defaultPolicy(), approvalAbove: 3000, allowedPayees: ['streamly', 'research'] } });
    const video = await this.createAgent(userId, { name: 'StudioAgent', purpose: 'Creates only the videos you authorize.', policy: { ...defaultPolicy(), approvalAbove: 1000, maxTransaction: 1000, allowedPayees: ['video'], frequency: 'unlimited' } });
    const base = { cadence: 'monthly' as const, maxUnits: 1, dueAt: now() };
    const electric = await this.createExpense(userId, { ...base, agentId: bill.id, payeeId: 'electric', title: 'Monthly electricity bill', amountCents: 18240 });
    await this.createExpense(userId, { ...base, agentId: bill.id, payeeId: 'internet', title: 'Fiber internet plan', amountCents: 2500 });
    const stream = await this.createExpense(userId, { ...base, agentId: sub.id, payeeId: 'streamly', title: 'Streamly monthly renewal', amountCents: 1599 });
    const research = await this.createExpense(userId, { ...base, agentId: sub.id, payeeId: 'research', title: 'Research API subscription', amountCents: 4200 });
    await this.createExpense(userId, { ...base, cadence: 'once', maxUnits: 5, agentId: video.id, payeeId: 'video', title: 'Five product videos', amountCents: 200 });
    await this.propose(userId, bill.id, electric.id, randomUUID());
    await this.propose(userId, sub.id, research.id, randomUUID());
    const paid = await this.propose(userId, sub.id, stream.id, randomUUID());
    await this.authorizeExecution(userId, paid.id, 'create'); await this.orderCreated(userId, paid.id, `SIM-${randomUUID()}`, null);
    await this.authorizeExecution(userId, paid.id, 'capture'); await this.settle(userId, paid.id, `SIM-${randomUUID()}`);
    const blocked = await this.createExpense(userId, { ...base, cadence: 'once', agentId: bill.id, payeeId: 'research', title: 'Unapproved API purchase', amountCents: 24000 });
    await this.propose(userId, bill.id, blocked.id, randomUUID());
  }
}
