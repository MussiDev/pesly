import { z } from 'zod';
import { exactIntegerStringSchema } from '../money';
import { budgetCurrencySchema } from './budget';

export const BUDGET_PERCENT_USED_CAP = 1000;

/** `YYYY-MM`, month 01 to 12, year 1971 or later so the previous month still falls after the epoch. */
export const budgetSpendingMonthSchema = z
  .string()
  .regex(/^(197[1-9]|19[89]\d|[2-9]\d{3})-(0[1-9]|1[0-2])$/);
export type BudgetSpendingMonth = z.infer<typeof budgetSpendingMonthSchema>;

/** `GET /budgets/spending` and `GET /budgets/:id/spending`; no month means the current month. */
export const budgetSpendingQuerySchema = z.strictObject({
  month: budgetSpendingMonthSchema.optional(),
});
export type BudgetSpendingQuery = z.infer<typeof budgetSpendingQuerySchema>;

export const budgetSpendingResponseSchema = z.object({
  budgetId: z.uuid(),
  name: z.string(),
  currency: budgetCurrencySchema,
  month: budgetSpendingMonthSchema,
  amount: exactIntegerStringSchema,
  rolloverEnabled: z.boolean(),
  rolloverAmount: exactIntegerStringSchema,
  /** The amount plus the rollover carried in. */
  available: exactIntegerStringSchema,
  spent: exactIntegerStringSchema,
  /** `available` minus `spent`; negative when the budget is overspent. */
  remaining: exactIntegerStringSchema,
  /** Rounded down and capped at 1,000. */
  percentUsed: z.number().int().min(0).max(BUDGET_PERCENT_USED_CAP),
  thresholds: z.array(z.number().int()),
  /** Group shares in the other currency that no frozen rate could convert; not in `spent`. */
  unconvertedShareCount: z.number().int().min(0),
  /** Card installments in the other currency that were left out of `spent`. */
  unconvertedInstallmentCount: z.number().int().min(0),
});
export type BudgetSpendingResponse = z.infer<typeof budgetSpendingResponseSchema>;

export const budgetSpendingListResponseSchema = z.object({
  month: budgetSpendingMonthSchema,
  budgets: z.array(budgetSpendingResponseSchema),
});
export type BudgetSpendingListResponse = z.infer<typeof budgetSpendingListResponseSchema>;
