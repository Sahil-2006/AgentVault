import { z } from 'zod';
export class AppError extends Error { constructor(public status: number, message: string) { super(message); } }
export const cents = z.number().int().min(0).max(100000000);
export const policySchema = z.object({
  maxTransaction: cents.min(1), approvalAbove: cents, dailyLimit: cents.min(1), monthlyLimit: cents.min(1),
  allowedPayees: z.array(z.enum(['electric', 'internet', 'streamly', 'video', 'research', 'sandbox'])).min(1).max(6),
  frequency: z.enum(['unlimited', 'daily', 'monthly']), expiresAt: z.iso.datetime(),
}).strict().refine(p => p.approvalAbove <= p.maxTransaction, { message: 'Approval threshold must not exceed the hard payment limit.' });
export const agentSchema = z.object({ name: z.string().trim().min(2).max(40), purpose: z.string().trim().min(2).max(160), policy: policySchema }).strict();
export const expenseSchema = z.object({
  agentId: z.string().uuid(), payeeId: z.enum(['electric', 'internet', 'streamly', 'video', 'research', 'sandbox']),
  title: z.string().trim().min(2).max(100), amountCents: cents.min(1),
  cadence: z.enum(['once', 'daily', 'monthly']), maxUnits: z.number().int().min(1).max(100), dueAt: z.iso.datetime(),
}).strict();
export const requestSchema = z.object({ expenseId: z.string().uuid(), clientKey: z.string().min(8).max(100) }).strict();
