import { randomUUID } from 'node:crypto';
import type { AgentRun } from '../shared/types.js';
import type { Queryable } from './db.js';
import { one } from './db.js';
import { plan } from './planner.js';
import { VaultService, mapRequest, now } from './service.js';
import { AppError, runSchema } from './validation.js';

const leaseMs = 120_000;
const selectRun = `SELECT r.*, a.name AS agent_name,
  CASE WHEN p.id IS NULL THEN NULL ELSE to_jsonb(p) END AS payment
  FROM agentvault.agent_runs r JOIN agentvault.agents a ON a.id=r.agent_id
  LEFT JOIN agentvault.requests p ON p.id=r.request_id AND p.user_id=r.user_id AND p.agent_id=r.agent_id`;
const mapRun = (r: any): AgentRun => ({
  id: r.id, agentId: r.agent_id, agentName: r.agent_name, prompt: r.prompt, status: r.status,
  mode: r.mode, explanation: r.explanation, error: r.error,
  request: r.payment ? mapRequest({ ...r.payment, agent_name: r.agent_name }) : null,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

export class AgentRuns {
  constructor(private vault: VaultService, private planner: typeof plan = plan) {}

  private async expire(tx: Queryable, userId: string) {
    // A proposal and its run finish in one transaction, so expired planning has no payment to recover.
    const expired = await tx.query(`UPDATE agentvault.agent_runs SET status='FAILED',error=$3,updated_at=$4
      WHERE user_id=$1 AND status='PLANNING' AND created_at<$2 RETURNING id`,
    [userId, new Date(Date.now() - leaseMs).toISOString(), 'Planning was interrupted. No payment request was created. Start a new run to try again.', now()]);
    for (const row of expired.rows) await this.vault.audit(tx, userId, 'run.failed', row.id, 'Planning expired without a payment request.');
  }

  private async read(tx: Queryable, userId: string, id: string, agentId?: string) {
    const row = await one(tx, `${selectRun} WHERE r.user_id=$1 AND r.id=$2 AND ($3::text IS NULL OR r.agent_id=$3)`, [userId, id, agentId || null]);
    if (!row) throw new AppError(404, 'Agent run not found.');
    return mapRun(row);
  }

  get(userId: string, id: string, agentId?: string) {
    return this.vault.locked(userId, async tx => { await this.expire(tx, userId); return this.read(tx, userId, id, agentId); });
  }

  list(userId: string, agentId: string) {
    return this.vault.locked(userId, async tx => {
      await this.vault.agent(tx, userId, agentId);
      await this.expire(tx, userId);
      const rows = await tx.query(`${selectRun} WHERE r.user_id=$1 AND r.agent_id=$2 AND
        (r.status='PLANNING' OR r.id IN (SELECT id FROM agentvault.agent_runs WHERE user_id=$1 AND agent_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50))
        ORDER BY r.created_at DESC,r.id DESC`, [userId, agentId]);
      return rows.rows.map(mapRun);
    });
  }

  async submit(userId: string, agentId: string, input: { prompt: string; clientKey: string }, tokenHash?: string): Promise<AgentRun> {
    const { prompt, clientKey } = runSchema.parse(input);
    const claimed = await this.vault.locked(userId, async (tx, user) => {
      const agent = await this.vault.agent(tx, userId, agentId);
      await this.expire(tx, userId);
      if (tokenHash && agent.token_hash !== tokenHash) throw new AppError(403, 'Agent token was replaced or revoked.');
      const existing = await one(tx, 'SELECT id,prompt FROM agentvault.agent_runs WHERE user_id=$1 AND agent_id=$2 AND client_key=$3', [userId, agentId, clientKey]);
      if (existing) {
        if (existing.prompt !== prompt) throw new AppError(409, 'This client key already belongs to a different prompt.');
        return { run: await this.read(tx, userId, existing.id), fresh: false, demo: user.is_demo, expenses: [] };
      }
      if (user.paused || agent.status !== 'active') throw new AppError(409, 'Resume the vault and agent before starting a run.');
      const active = await one(tx, "SELECT count(*)::int AS count FROM agentvault.agent_runs WHERE user_id=$1 AND status='PLANNING'", [userId]);
      if (active!.count >= 3) throw new AppError(429, 'Three runs are already planning. Wait for them to finish.');
      const id = randomUUID();
      await tx.query(`INSERT INTO agentvault.agent_runs(id,user_id,agent_id,client_key,prompt,status,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,'PLANNING',$6,$6)`, [id, userId, agentId, clientKey, prompt, now()]);
      await this.vault.audit(tx, userId, 'run.started', id, `${agent.name} started a task selection.`);
      const expenses = (await tx.query('SELECT * FROM agentvault.expenses WHERE user_id=$1 AND agent_id=$2 AND active=true', [userId, agentId])).rows;
      return { run: await this.read(tx, userId, id), fresh: true, demo: user.is_demo, expenses };
    });
    if (!claimed.fresh) return claimed.run;

    try {
      // Provider calls stay outside the budget lock. All authority is checked again on completion.
      const choice = await this.planner(this.vault.config, prompt, claimed.expenses, claimed.demo);
      return await this.vault.locked(userId, async (tx, user) => {
        await this.expire(tx, userId);
        const current = await this.read(tx, userId, claimed.run.id);
        if (current.status !== 'PLANNING') return current;
        const agent = await this.vault.agent(tx, userId, agentId);
        if (tokenHash && agent.token_hash !== tokenHash) throw new AppError(403, 'Agent token was replaced or revoked while planning. No request was created.');
        if (choice.expenseId && !claimed.expenses.some(e => e.id === choice.expenseId)) throw new AppError(502, 'The planner selected an unauthorized task. No request was created.');
        const payment = choice.expenseId ? await this.vault.proposeLocked(tx, user, agentId, choice.expenseId, `run:${claimed.run.id}`) : null;
        const status = payment ? 'SUBMITTED' : 'NEEDS_INPUT';
        await tx.query('UPDATE agentvault.agent_runs SET status=$2,mode=$3,explanation=$4,request_id=$5,updated_at=$6 WHERE id=$1',
          [claimed.run.id, status, choice.mode, choice.explanation, payment?.id || null, now()]);
        await this.vault.audit(tx, userId, `run.${status.toLowerCase()}`, claimed.run.id, payment ? `Task selection checked: ${payment.state}.` : 'No task selected. A clearer prompt is needed.');
        return this.read(tx, userId, claimed.run.id);
      });
    } catch (error) {
      return this.vault.locked(userId, async tx => {
        const current = await this.read(tx, userId, claimed.run.id);
        if (current.status !== 'PLANNING') return current;
        const message = error instanceof AppError ? error.message : 'Planning could not finish. No payment request was created. Start a new run to try again.';
        await tx.query("UPDATE agentvault.agent_runs SET status='FAILED',error=$2,updated_at=$3 WHERE id=$1", [claimed.run.id, message, now()]);
        await this.vault.audit(tx, userId, 'run.failed', claimed.run.id, message);
        return this.read(tx, userId, claimed.run.id);
      });
    }
  }
}
