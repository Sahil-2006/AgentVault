// Kept as a module so Vercel includes the migration in the server bundle.
export const schema = `
CREATE SCHEMA IF NOT EXISTS agentvault;
CREATE TABLE IF NOT EXISTS agentvault.users (
 id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL,
 budget_cents INTEGER NOT NULL DEFAULT 80000 CHECK(budget_cents >= 0), paused BOOLEAN NOT NULL DEFAULT false,
 is_demo BOOLEAN NOT NULL DEFAULT false, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agentvault.sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES agentvault.users(id) ON DELETE CASCADE,
 csrf TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agentvault.agents (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES agentvault.users(id), name TEXT NOT NULL, purpose TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','revoked')), policy JSONB NOT NULL,
 policy_version INTEGER NOT NULL DEFAULT 1, token_hash TEXT UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agentvault.expenses (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES agentvault.users(id), agent_id TEXT NOT NULL REFERENCES agentvault.agents(id),
 payee_id TEXT NOT NULL, title TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 cadence TEXT NOT NULL CHECK(cadence IN ('once','daily','monthly')), max_units INTEGER NOT NULL CHECK(max_units > 0),
 active BOOLEAN NOT NULL DEFAULT true, due_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agentvault.requests (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES agentvault.users(id), agent_id TEXT NOT NULL REFERENCES agentvault.agents(id),
 expense_id TEXT NOT NULL REFERENCES agentvault.expenses(id), payee_id TEXT NOT NULL, title TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), currency TEXT NOT NULL DEFAULT 'USD',
 state TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT NOT NULL, checks JSONB NOT NULL,
 policy_version INTEGER NOT NULL, approved_at TEXT, occurrence TEXT NOT NULL, client_key TEXT NOT NULL,
 order_id TEXT UNIQUE, capture_id TEXT UNIQUE, approval_url TEXT, simulated BOOLEAN NOT NULL,
 create_key TEXT NOT NULL, capture_key TEXT NOT NULL, operation_started_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id, client_key)
);
CREATE TABLE IF NOT EXISTS agentvault.sandbox_setups (
 user_id TEXT PRIMARY KEY REFERENCES agentvault.users(id),
 agent_id TEXT NOT NULL REFERENCES agentvault.agents(id),
 expense_id TEXT NOT NULL REFERENCES agentvault.expenses(id)
);
CREATE TABLE IF NOT EXISTS agentvault.ledger (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES agentvault.users(id), request_id TEXT REFERENCES agentvault.requests(id),
 kind TEXT NOT NULL, amount_cents INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(request_id, kind)
);
CREATE TABLE IF NOT EXISTS agentvault.audit (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES agentvault.users(id), action TEXT NOT NULL,
 subject_id TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agentvault.webhooks (
 id TEXT PRIMARY KEY, processed_at TEXT NOT NULL, event_type TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agentvault.rate_limits (
 key TEXT PRIMARY KEY, window_start BIGINT NOT NULL, count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS av_requests_user ON agentvault.requests(user_id, created_at);
CREATE INDEX IF NOT EXISTS av_requests_agent ON agentvault.requests(agent_id, created_at);
CREATE INDEX IF NOT EXISTS av_requests_expense ON agentvault.requests(expense_id, occurrence);
CREATE INDEX IF NOT EXISTS av_audit_user ON agentvault.audit(user_id, created_at);
CREATE INDEX IF NOT EXISTS av_sessions_user ON agentvault.sessions(user_id);
-- Private schema is never exposed through Supabase's public Data API.
REVOKE ALL ON SCHEMA agentvault FROM PUBLIC;
`;
