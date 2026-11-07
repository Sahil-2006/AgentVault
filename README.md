# AgentVault

AI agents propose spending. Your permissions decide what can proceed.

**Hosted app:** https://agentvault-indol.vercel.app · **Custom domain:** cubecomet.in (DNS setup required)

AgentVault is a working full-stack permission layer with a React dashboard, Express API, persistent PostgreSQL data, scoped agent tokens, and a PayPal Sandbox adapter. The vault is a **virtual spending allowance**, not a separately funded PayPal account. This release never moves live money.

## Try it

Choose **Create your vault** and register or sign in to use PayPal Sandbox. On Overview, choose **Open $1 Sandbox test → Prepare $1 test**. Approve the request, continue to PayPal, sign in with a **Personal Sandbox buyer** (not the merchant account), approve, then confirm the payment after returning to AgentVault. The receipt shows the provider order and capture IDs. Test money only.

The starter creates one agent and one task limited to a single $1 payment. Reopening it returns the same request; it cannot duplicate a charge. Existing budgets, pauses and permissions still apply. Create additional authorized tasks for further tests.

Choose **Explore simulation** for a private, seeded workspace without PayPal payments. You can edit permissions, pause agents, or run the five-video control test. The **Use PayPal Sandbox** button opens account creation; demo data is never silently converted into payable requests.

## Run locally

Requires Node.js 24 and npm.

```sh
npm ci
cp .env.example .env
npm run dev
```

On PowerShell use `Copy-Item .env.example .env`. Open http://127.0.0.1:5173. Without DATABASE_URL, local development uses embedded PostgreSQL in `data/postgres`. Restarting preserves data. Production requires hosted PostgreSQL and never falls back to local storage.

```sh
npm test       # security, concurrency, integration-boundary tests
npm run build # TypeScript check + production frontend
npm start     # serves API and built frontend; set APP_ORIGIN to the server's URL
```

## Implemented

- Account registration, scrypt password hashes, expiring server sessions, CSRF checks and database-backed rate limits.
- Agent registration, scoped tokens, pause/revoke and a global pause switch.
- Per-payment, daily/monthly, payee, expiry, frequency and task-quantity restrictions.
- Approval workflow, reserved budgets, idempotent requests, audit trail and CSV export.
- PayPal Sandbox order creation, separate buyer approval and capture, server verification and signed webhook processing.
- Gemini task selection when configured; an explicitly labeled local matcher otherwise. The model cannot change prices, payees or permissions.
- Responsive landing page and workspace based on the supplied AgentVault design.

## Why changing IPs does not reset the allowance

Every proposal locks the owner's shared vault row before checking limits and reserving funds. Tasks have fixed owner-approved prices, payees and operation counts. Agent credentials identify the same vault across workers and IPs. The automated 500-proposal test reserves five $2 operations and blocks 495. Agent tokens cannot create tasks, edit limits, approve exceptions or capture payments.

Amounts are integer USD cents. Limit periods use UTC. Outstanding reservations count against the current spending period. A pause stops new dispatches; a payment already sent to the provider can still complete. Uncertain provider outcomes retain reservations rather than permitting a replacement charge.

## Deployment and team references

- [Vercel, database, PayPal, Gemini and domain setup](docs/DEPLOYMENT.md)
- [Agent API and payment flow](docs/API.md)
- [Three-minute demo script](docs/DEMO_SCRIPT.md)
- [Original shared team plan](docs/IMPLEMENTATION_PLAN.md) — design Oct 20, implementation Oct 25, video Oct 30, 2026; all five members work together in each phase. These are the original milestones, not a claim they were completed on time.
- [Original technical reference](docs/TECHNICAL_REFERENCE.md) — planning context; this README and implementation describe current behavior.

## Current boundaries

Payees are configured test-service labels, all routed to the configured sandbox merchant. Existing consumer bills/autopays are not discovered or imported. Tasks run on demand, not on an unattended schedule. Gemini and PayPal require server credentials and a real sandbox verification before being described as tested integrations. Email verification, password recovery and MFA are not implemented. Audit records are application records, not an independently tamper-proof financial ledger. Unknown order-creation outcomes require operator reconciliation; the app deliberately keeps their reservations.

Universal service acceptance, segregated funded wallets and live autonomous spending require additional provider capabilities and review. The app must not be advertised as providing those guarantees.
