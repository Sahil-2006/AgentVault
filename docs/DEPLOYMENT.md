# Deployment

The Vercel project is `sahil-2006s-projects/agentvault`, connected to this GitHub repository. Node 24 runs the API; Vite builds the frontend. The API and Neon database use Singapore. Deployment rewrites keep the browser and API on the same origin.

## Required configuration

Set variables in **Vercel → AgentVault → Settings → Environment Variables**. Never commit credentials or use a `VITE_` prefix for secrets. Redeploy after changing variables.

| Variable | Purpose |
| --- | --- |
| DATABASE_URL | Pooled Postgres URL with TLS; provided by the connected Neon resource |
| APP_ORIGIN | Canonical HTTPS origin, currently `https://agentvault-indol.vercel.app` |
| PAYMENT_MODE | `sandbox` for registered accounts, or `simulation` |
| DEMO_ENABLED | `true` exposes private simulation workspaces; defaults off when hosted |
| PAYPAL_CLIENT_ID | Sandbox REST app client ID |
| PAYPAL_CLIENT_SECRET | Same sandbox app secret |
| PAYPAL_MERCHANT_ID | Business sandbox account merchant ID corresponding to that app |
| PAYPAL_WEBHOOK_ID | Webhook registered in that sandbox app |
| GEMINI_API_KEY | Optional Google AI Studio API key; only the backend calls the model |
| GEMINI_MODEL | Defaults to `gemini-2.5-flash`; use a model available to your key |

Demo workspaces always use simulated payments and the local matcher, even when integrations are configured. A configured key is not evidence that authentication or payment has succeeded.

## Database

The free `agentvault-db` Neon resource is connected through Vercel. The backend initializes its private `agentvault` schema under an advisory transaction lock. The SQL source is `backend/schema.ts`. All SQL parameters are bound; the browser never receives the database URL. On Supabase, keep this schema out of the Data API's exposed schemas. This implementation uses server-side owner scoping, not Supabase client authentication or RLS.

Use separate databases/Neon branches for preview and production before testing changes with real user data. Configure provider backups and retention for the intended launch scale. The current automatic schema creation is idempotent; future schema alterations need versioned migrations.

## PayPal Sandbox verification

1. Create a sandbox REST app and a business test account in the [PayPal developer dashboard](https://developer.paypal.com/dashboard/). Set the three credentials above on the server.
2. Register `https://agentvault-indol.vercel.app/api/webhooks/paypal` for `PAYMENT.CAPTURE.COMPLETED` and save its webhook ID.
3. Sign into a regular AgentVault account. Under Settings, test PayPal authentication.
4. Register an agent, authorize a fixed-price task and propose it. Approve it if required, then choose PayPal checkout.
5. Log in with a separate sandbox buyer. Approve there and return to AgentVault. Confirm capture in AgentVault.
6. Verify a provider order ID, capture ID, completed state, exactly one settlement and a verified webhook. Also test cancel, pause before capture and a provider timeout.

The return URL is not evidence of payment. The backend retrieves the order and checks order identity, reference, amount, currency and merchant. Create/capture use separate stable idempotency keys. Webhooks must pass PayPal's signature verification endpoint. Timeouts keep funds reserved; “Check status” reads provider state and does not create a new charge. A lost order-creation result cannot currently be recovered in the UI; reconcile with the provider using the stored idempotency key before making administrative changes.

This is a single-merchant sandbox integration. It does not authorize arbitrary third-party bill payments or access a consumer's existing subscriptions. [PayPal Orders API](https://developer.paypal.com/docs/api/orders/v2/) · [Webhook verification](https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature_post).

## Gemini verification

Set GEMINI_API_KEY, create a regular account, add a task and ask for it under Bills & tasks. The model receives the prompt plus that agent's active task titles, IDs, amounts and payee labels. It returns one task ID and explanation. Unknown IDs and malformed responses fail closed; no model output can edit a price or initiate capture. [Gemini structured output documentation](https://ai.google.dev/gemini-api/docs/structured-output).

## cubecomet.in

The domain is attached to the Vercel project. Its authoritative nameservers are Hostinger's `dns-parking.com` servers. Vercel's domain check returned these required root records on November 3, 2026:

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 216.198.79.1 |
| A | @ | 64.29.17.1 |

Replace the old root A record `2.57.91.91` with those two records at the DNS provider. Preserve unrelated mail and other records. Run `vercel domains verify cubecomet.in` to confirm the current recommendation and propagation. After HTTPS is ready, change APP_ORIGIN and the PayPal webhook URL to `https://cubecomet.in` and redeploy. The Vercel URL remains usable for viewing; authenticated writes use the canonical origin.

## Release checks

```sh
npm ci
npm run verify
vercel deploy --prod
```

Confirm `/api/health` returns `status: ok`, create a private demo and complete a simulated payment. Check sign-in persistence after reload, owner boundaries, mobile layout, and freeze/revoke. Then run the separate sandbox checks with credentials. The database connection must fail closed if configuration is absent; never substitute in-memory state in a serverless deployment.
