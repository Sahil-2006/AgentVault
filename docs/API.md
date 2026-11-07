# Agent API

Issue a scoped token in **Agents → API access**. Only its hash is stored. Rotating replaces the old token; revoking the agent invalidates it. Keep the raw token in the calling agent's server environment.

```http
GET /api/agent/tasks
Authorization: Bearer <agent-token>
```

Returns only that agent's active, owner-authorized tasks. No provider credentials are exposed.

```http
POST /api/agent/requests
Authorization: Bearer <agent-token>
Content-Type: application/json

{"expenseId":"<authorized-task-uuid>","clientKey":"<stable-uuid-for-this-intent>"}
```

Retry the same intent with the same clientKey. The result is the original request. Rebinding the key to another task fails. Do not send an amount or payee: the backend reads immutable values from the owner's task. Unknown fields are rejected.

Successful evaluation returns a request in `READY`, `AWAITING_APPROVAL` or `BLOCKED`. Agents cannot approve, edit the vault, create tasks or capture payments. Owner routes require an HttpOnly session cookie, the canonical Origin, and an `X-CSRF-Token` obtained through the authenticated `/api/auth/me` response.

## Payment states

For a signed-in, non-demo Sandbox workspace, `POST /api/integrations/paypal/setup` prepares a single $1 test request with mandatory owner approval. Setup is idempotent per owner and does not change existing budgets, resume agents, or capture money. `POST /api/integrations/paypal/test` verifies server credentials. Both require the owner session, Origin, and CSRF token.

```text
proposal ─── blocked
    │
    ├── awaiting approval ─── rejected / canceled / blocked
    │         │ approve + recheck
    └──────── ready (budget reserved)
                │
             creating checkout
                │
             awaiting buyer approval
                │ owner capture + fresh policy check
             capturing ─── completed
                │ timeout
             reconciling (reservation retained)
```

Pause/revoke cancels requests whose capture has not been dispatched. In-flight calls may still finish. Policy changes invalidate outstanding safe-to-cancel requests. Delayed daily/monthly task requests must be resubmitted for the current period. Manual approval does not override hard limits.

Errors use JSON `{ "error": "message" }`, with 400 for invalid data, 401/403 for missing authority, 404 for inaccessible resources, 409 for stale/unsafe transitions, 429 for request limits, and 502/503 for provider/configuration failures.

The UI displays the latest 250 requests, all open requests, and 100 audit events; older data remains in PostgreSQL. This release has no external scheduled worker. An external agent may propose tasks through this API, but owner checkout is still required.
