export type Frequency = 'unlimited' | 'daily' | 'monthly';
export type PaymentState = 'AWAITING_APPROVAL' | 'READY' | 'CREATING' | 'AWAITING_PAYER' | 'CAPTURING' | 'RECONCILING' | 'COMPLETED' | 'BLOCKED' | 'REJECTED' | 'CANCELED' | 'FAILED';
export interface Policy {
  maxTransaction: number; approvalAbove: number; dailyLimit: number; monthlyLimit: number;
  allowedPayees: string[]; frequency: Frequency; expiresAt: string;
}
export interface User { id: string; name: string; email: string; budgetCents: number; paused: boolean; isDemo: boolean }
export interface Agent { id: string; name: string; purpose: string; status: 'active' | 'paused' | 'revoked'; policy: Policy; policyVersion: number; hasToken: boolean }
export interface Payee { id: string; name: string; category: string }
export interface Expense { id: string; agentId: string; payeeId: string; title: string; amountCents: number; cadence: 'once' | 'daily' | 'monthly'; maxUnits: number; active: boolean; dueAt: string }
export interface PaymentRequest {
  id: string; agentId: string; expenseId: string; agentName: string; payeeId: string; payeeName: string; title: string;
  amountCents: number; currency: string; state: PaymentState; decision: string; reason: string;
  createdAt: string; updatedAt: string; policyVersion: number; orderId: string | null; captureId: string | null;
  simulated: boolean; approvedAt: string | null; checks: { label: string; passed: boolean; detail: string }[];
}
export interface AuditEvent { id: string; action: string; subjectId: string; detail: string; createdAt: string }
export interface Overview {
  user: User; agents: Agent[]; expenses: Expense[]; requests: PaymentRequest[]; events: AuditEvent[]; payees: Payee[];
  totals: { spent: number; reserved: number; available: number; monthSpent: number; activeAgents: number; approvals: number };
  integration: { paymentMode: 'simulation' | 'sandbox'; paypalConfigured: boolean; webhookConfigured: boolean; planner: 'local' | 'gemini' };
}
