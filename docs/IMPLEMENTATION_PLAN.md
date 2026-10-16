# AgentVault — team plan

**5 people · October 2026 · IST**

**Design: October 20 · Implementation: October 25 · Video: October 30**

**All five of us work on the same phase together.** Split small tasks within that phase and review the result together before moving on.

AgentVault gives AI a separate, limited vault for spending across supported services. PayPal is our first integration. The demo uses simulated funds and PayPal Sandbox; real funding isolation still needs provider verification.

## Schedule

| Date | Work |
| --- | --- |
| **Oct 16 — today** | **Light: a quick team discussion to agree on the idea. About 15 minutes.** |
| **Oct 17 — tomorrow** | **Light: share 2–3 UI references. About 20 minutes.** |
| Oct 18 | Sketch the four main screens. |
| Oct 19 | Finish the main screen designs. |
| **Oct 20** | Review together, make small fixes, and finalize design. |
| Oct 21 | Set up the app, database, AI access, and PayPal Sandbox. Agree the basic API/data structure. |
| Oct 22 | Build vault balances, spending limits, and AI task requests. |
| Oct 23 | Connect payments, approvals, history, and freeze. |
| Oct 24 | Test the full flow and five-versus-500 scenario; fix bugs. |
| **Oct 25** | Finish testing and deployment. Implementation complete. |
| Oct 26 | Write a short video script. |
| Oct 27 | Record the demo and voiceover. |
| Oct 28 | Edit the video and add captions. |
| Oct 29 | Review and make final fixes. |
| **Oct 30** | Export, check, and finish the video. |

Today and tomorrow have no coding or technical deliverables. Main design work starts October 18.

## Keep design simple

Only four main screens:

1. **Dashboard:** vault balance, agents, recent activity.
2. **Vault setup:** allocate a budget and set limits.
3. **Agent/task:** enter a task, view expenses, see progress, approve a request.
4. **Activity:** successful/blocked payments and their reasons.

Use an approval popup and a visible freeze button. Pick one font and a small color palette; reuse buttons and cards.

**Design done = four screens + one simple click-through flow.**

## Shared phases

| Dates | All five work on |
| --- | --- |
| Oct 16–20 | Design: references, sketches, screens, and final review |
| Oct 21–25 | Implementation: build, connect, test, and deploy |
| Oct 26–30 | Video: script, recording, editing, and final review |

Choose small tasks or pairs each day based on what the current phase needs. New teammates join the phase the team is working on.

## What the demo must show

- Create a vault, assign an agent, and set money/task limits.
- AI proposes a task or expense; the backend checks the rules.
- An allowed payment completes through PayPal Sandbox.
- Approval, blocked payments, history, and freeze work.
- A simulated burst of 500 requests cannot exceed a five-job limit or the shared vault budget, even across workers/IPs.

The AI cannot refill its vault or charge the main account. Reserve money and task slots before paid work starts; the actual provider must enforce the funding boundary for a real-money version.

Engineering details are kept separately in [TECHNICAL_REFERENCE.md](TECHNICAL_REFERENCE.md) for the implementation phase. Confirm the event's submission time and video format when setup begins on October 21.
