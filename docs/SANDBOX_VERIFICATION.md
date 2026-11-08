# Hosted Sandbox verification — November 8, 2026

Application: https://agentvault-indol.vercel.app

The deployed application completed a $1 USD payment through the actual PayPal Sandbox API and buyer checkout, using a separate US Personal test buyer and the configured Business test merchant. No live money moved.

| Check | Result |
| --- | --- |
| Guided setup | One agent; one $1 task; owner approval required |
| AgentVault approval | Limits checked; $1 reserved |
| PayPal buyer approval | Completed in Sandbox checkout |
| Server capture | COMPLETED |
| Provider order | `6GP99593L26571023` |
| Provider capture | `91B12307VE8206649` |
| Provider verification | Order identity, $1.00 USD amount, configured merchant and one completed capture matched |
| Application totals | $1.00 spent; $0.00 reserved; $799.00 available |
| Webhook | Production POST `/api/webhooks/paypal` returned 200 at 2026-11-08 11:17:02 UTC; handler requires PayPal signature verification |
| Interrupted checkout | Previous unapproved order canceled; reservation released; new request required fresh owner approval |
| Automated checks | 22 passed, including concurrent setup, owner approval, provider adapter flow, duplicate capture and webhook processing |

The original India Personal buyer returned a seller-currency error for this USD checkout. A US Personal Sandbox buyer was created in the developer dashboard and completed the test. Find its generated credentials under **Testing Tools → Sandbox Accounts → Personal / US → Login info**. Never use a live PayPal login or the Business merchant login as the test buyer.

The webhook event-list API was still empty during verification; actual delivery was confirmed through Vercel's production request log. The application also independently verifies capture by retrieving the PayPal order, so completion does not rely on a redirect or webhook timing.

This confirms Sandbox payments and application controls. Vault balances remain virtual allowances. Consumer utility accounts, existing autopays, universal service acceptance and live-money custody are not connected. Gemini remains optional and unconfigured; the UI labels the active local task matcher.
