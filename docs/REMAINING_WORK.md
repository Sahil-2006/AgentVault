# AgentVault: what is done and what is left

**Updated November 8, 2026.** [Live app](https://agentvault-indol.vercel.app) · [Repository](https://github.com/Sahil-2006/AgentVault)

The hosted Sandbox payment flow works. The broader autonomous-agent product is still unfinished. This checklist describes remaining work; it does not claim these features have been implemented.

## Already working

- Registration/login, persistent PostgreSQL storage, dashboard, agents and owner-authorized tasks.
- Spending and task-count limits, allowed payees, expiry, approvals, pause/revoke and scoped agent tokens.
- PayPal Sandbox checkout, buyer approval, capture, receipts and verified webhooks. A hosted $1 payment completed on November 8; see [the verification record](SANDBOX_VERIFICATION.md).
- Shared budget reservations, duplicate-request protection, activity history, CSV export and the five-versus-500 simulation.
- Gemini adapter and local task matching. **Gemini is not configured or verified in production.**
- Vercel deployment and Neon database. The latest recorded automated run passed all 22 tests.

## Finish the core workflow

All five teammates can work through these items together, splitting small tasks within the current phase.

| Left to do | How to finish it | Completion check |
| --- | --- | --- |
| **1. Saved agent runs** | Add a run record connecting the prompt, selected task, policy decision and payment request. Use a stable client key so retries return the same run. Add owner run history and token-scoped run/status endpoints. Start in `backend/planner.ts`, `backend/service.ts`, `backend/app.ts`, `backend/schema.ts` and the task UI. | A prompt creates one traceable proposal. Reloading or retrying never duplicates it. Another owner or agent cannot read it. |
| **2. Scheduled tasks** | Add an owner-controlled “auto-propose when due” setting and an authenticated scheduled worker. Use a unique task/period key and recheck permissions under the shared vault lock. Add a manual “Run due tasks” action. | Repeated or overlapping worker calls produce one proposal per due occurrence. Paused/revoked agents cannot proceed. Buyer approval remains required for this checkout integration. |
| **3. Interrupted-payment recovery** | Extend the current status check to handle lost order-creation responses, stale in-flight requests and confirmed failures. Record dispatch times, verify provider state and reuse the original idempotency key only within the provider's supported retry window. Keep uncertain funds reserved. Start in `backend/paypal.ts`, `backend/service.ts` and the request routes. | Timeout/crash tests cannot produce a second charge. Confirmed failures release the reservation once; completed payments settle once. A pause prevents any new dispatch during recovery. |
| **4. Smoother PayPal return** | On return from approved checkout, let the UI request capture and display progress. The backend must still retrieve the order and recheck policy. Keep the manual confirmation/status action as a fallback. | A successful buyer approval reaches the receipt without an extra confirmation click. A forged return URL cannot trigger an unapproved payment. |
| **5. Real AI activation — deferred by Sahil** | Add `GEMINI_API_KEY` to **Vercel → AgentVault → Settings → Environment Variables → Production**, then redeploy. Use a regular account, authorize a task and ask for it under Bills & tasks. If needed, set `GEMINI_MODEL` to one available to that key. Add a connection test and clear provider-error UI. | The planner reports Gemini and selects only a saved task. Invalid output, an unknown task or a provider error cannot initiate a payment. Demo accounts deliberately keep the local matcher. |
| **6. External agent example** | Add a small runnable client using the existing [agent API](API.md): list tasks, submit a task with a stable client key, then read status once that endpoint exists. Store only the scoped AgentVault token in the client environment. | Two client processes share the same limits. Retrying returns the original request. Revoking the token stops further access. |

The first four rows are implementation work, not missing credentials. Gemini is the remaining provider credential for AI task selection; PayPal Sandbox credentials are already configured.

## Hosting and release work

| Left to do | How to finish it |
| --- | --- |
| **Connect cubecomet.in** | In [Vercel domain settings](https://vercel.com/sahil-2006s-projects/agentvault/settings/domains), copy the current required DNS record to the domain's DNS provider. The November 8 CLI check recommended root A `76.76.21.21`; check the dashboard again before editing. After Vercel confirms valid DNS and HTTPS, update `APP_ORIGIN` and the PayPal webhook URL, redeploy and retest login/payment. Detailed steps: [Deployment](DEPLOYMENT.md#cubecometin). |
| **Account recovery** | Configure an email service and implement verified email plus single-use, expiring password-reset links. Add appropriate rate limits and session invalidation. MFA is a further account-security improvement. |
| **Release operations** | Separate preview and production databases, introduce versioned migrations, configure backups and test a restore. Add error alerts and a view of unresolved payments. Run the existing verification suite in GitHub Actions for each change. |
| **Final team QA** | After the code changes, run `npm run verify`, the hosted simulation smoke test, and a fresh Sandbox buyer payment. Exercise failed/abandoned checkout, timeouts, repeated requests, pause/revoke, multiple owners and mobile layouts. Update the verification record with actual results. |
| **Demo video** | Rehearse the [three-minute script](DEMO_SCRIPT.md), record the actual dashboard and Sandbox receipt, then edit narration/captions and export. The script exists; the finished recording is still needed. |

`cubecomet.in` is attached to the project but was not serving a healthy HTTPS app during the November 8 check. Use the Vercel URL until the domain is verified. Production `/api/health` returned HTTP 200 with PostgreSQL and Sandbox mode.

## Broader product work before real money

The current vault is a **virtual spending allowance**. It is not a separately funded financial account. All test payee labels route to one configured Sandbox merchant, and tasks do not create actual videos or pay existing utility accounts.

To deliver the full original idea, the team must first confirm a provider-supported way to enforce separate funds and delegated authority, then integrate approved merchants/services and their authorization flows. Existing subscriptions, unattended autopay, refunds/disputes and live-money handling each need supported provider capabilities, implementation and testing. The code deliberately has no live-money mode; changing credentials alone will not deliver these features.

## References

- [Deployment and configuration](DEPLOYMENT.md)
- [Current agent API](API.md)
- [Vercel scheduled-job security, retries and concurrency](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs)
- [Vercel custom-domain setup](https://vercel.com/docs/domains/working-with-domains/add-a-domain)

The October 20/25/30 dates in the original team plan are historical targets. Agree new dates after selecting which remaining items are required for the next release.
