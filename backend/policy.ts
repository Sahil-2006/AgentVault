import type { Policy } from '../shared/types.js';

export interface PolicyContext {
  paused: boolean; agentStatus: string; policy: Policy; amount: number; payee: string; available: number;
  dayUsed: number; monthUsed: number; frequencyUsed: number; taskUsed: number; maxUnits: number;
  expenseActive: boolean; dueAt: string; now?: Date;
}
export function evaluatePolicy(c: PolicyContext) {
  const now = c.now || new Date();
  const checks = [
    { label: 'Agent access', passed: !c.paused && c.agentStatus === 'active', detail: c.paused ? 'All agents are paused.' : `Agent is ${c.agentStatus}.` },
    { label: 'Permission expiry', passed: Date.parse(c.policy.expiresAt) > now.getTime(), detail: `Expires ${c.policy.expiresAt.slice(0, 10)}.` },
    { label: 'Approved payee', passed: c.policy.allowedPayees.includes(c.payee), detail: c.policy.allowedPayees.includes(c.payee) ? 'Payee is in your allowlist.' : 'This payee is not authorized.' },
    { label: 'Authorized task', passed: c.expenseActive && Date.parse(c.dueAt) <= now.getTime(), detail: c.expenseActive ? 'Task must be due before it can run.' : 'This task is disabled.' },
    { label: 'Task quantity', passed: c.taskUsed < c.maxUnits, detail: `${c.taskUsed} of ${c.maxUnits} authorized operations used or pending.` },
    { label: 'Hard payment limit', passed: c.amount <= c.policy.maxTransaction, detail: `Maximum $${(c.policy.maxTransaction / 100).toFixed(2)} per payment.` },
    { label: 'Vault balance', passed: c.amount <= c.available, detail: `$${(c.available / 100).toFixed(2)} available after reservations.` },
    { label: 'Daily limit', passed: c.dayUsed + c.amount <= c.policy.dailyLimit, detail: `$${(c.dayUsed / 100).toFixed(2)} spent or reserved today; $${(c.policy.dailyLimit / 100).toFixed(2)} limit.` },
    { label: 'Monthly limit', passed: c.monthUsed + c.amount <= c.policy.monthlyLimit, detail: `$${(c.monthUsed / 100).toFixed(2)} spent or reserved this month; $${(c.policy.monthlyLimit / 100).toFixed(2)} limit.` },
    { label: 'Payment frequency', passed: c.policy.frequency === 'unlimited' || c.frequencyUsed === 0, detail: c.policy.frequency === 'unlimited' ? 'Within task quantity and money limits.' : `Once per ${c.policy.frequency === 'daily' ? 'day' : 'month'} for this agent and payee.` },
  ];
  const fail = checks.find(check => !check.passed);
  const needsApproval = c.amount > c.policy.approvalAbove;
  checks.push({ label: 'Owner approval', passed: !needsApproval, detail: needsApproval ? `Above your $${(c.policy.approvalAbove / 100).toFixed(2)} automatic approval threshold.` : 'Within your automatic approval threshold.' });
  return { decision: fail ? 'DENY' : needsApproval ? 'REQUIRES_APPROVAL' : 'ALLOW', reason: fail ? `${fail.label}: ${fail.detail}` : needsApproval ? 'Your approval is required before checkout.' : 'All permission checks passed. Ready for checkout.', checks };
}
