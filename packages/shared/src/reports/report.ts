import { z } from 'zod';
import { ACCOUNT_CURRENCIES } from '../accounts/account';
import { exactIntegerStringSchema } from '../money';
import { localDateSchema } from '../movements/movement-filters';
import { movementTagSchema } from '../movements/tag';

const reportCurrencySchema = z.enum(ACCOUNT_CURRENCIES);

/** `YYYY-MM`, month 01 to 12. */
const reportMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** `GET /reports/expenses-by-category` and `GET /reports/income-expenses`. */
export const reportFlowQuerySchema = z.strictObject({
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  accountId: z.uuid().optional(),
  tag: movementTagSchema.optional(),
});
export type ReportFlowQuery = z.infer<typeof reportFlowQuerySchema>;

/** `GET /reports/net-worth`: no account or tag filter. */
export const netWorthQuerySchema = z.strictObject({
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
});
export type NetWorthQuery = z.infer<typeof netWorthQuerySchema>;

export const expensesByCategoryRowSchema = z.object({
  /** Null for the shares that match no personal category. */
  categoryId: z.uuid().nullable(),
  name: z.string().nullable(),
  defaultKey: z.string().nullable(),
  amount: exactIntegerStringSchema,
});

export const expensesByCategoryResponseSchema = z.object({
  currency: reportCurrencySchema,
  from: localDateSchema,
  to: localDateSchema,
  total: exactIntegerStringSchema,
  categories: z.array(expensesByCategoryRowSchema),
  unconvertedShareCount: z.number().int().min(0),
  unconvertedInstallmentCount: z.number().int().min(0),
});
export type ExpensesByCategoryResponse = z.infer<typeof expensesByCategoryResponseSchema>;

export const incomeExpensesMonthSchema = z.object({
  month: reportMonthSchema,
  income: exactIntegerStringSchema,
  expenses: exactIntegerStringSchema,
});

export const incomeExpensesResponseSchema = z.object({
  currency: reportCurrencySchema,
  from: localDateSchema,
  to: localDateSchema,
  months: z.array(incomeExpensesMonthSchema),
  unconvertedShareCount: z.number().int().min(0),
  unconvertedInstallmentCount: z.number().int().min(0),
});
export type IncomeExpensesResponse = z.infer<typeof incomeExpensesResponseSchema>;

/**
 * `ars` and `usd` are in their own currencies; `total` is in the display currency. Exactly one of
 * `total` and `reason` is set: no rate for a non-zero foreign component gives `total` null and
 * `reason` `no_rate`.
 */
export const netWorthPointSchema = z
  .object({
    date: localDateSchema,
    ars: exactIntegerStringSchema,
    usd: exactIntegerStringSchema,
    total: exactIntegerStringSchema.nullable(),
    reason: z.literal('no_rate').nullable(),
    investmentsIncomplete: z.boolean(),
  })
  .refine((point) => (point.total === null) === (point.reason !== null), {
    message: 'Exactly one of total and reason must be set',
  });
export type NetWorthPoint = z.infer<typeof netWorthPointSchema>;

export const netWorthResponseSchema = z.object({
  currency: reportCurrencySchema,
  from: localDateSchema,
  to: localDateSchema,
  points: z.array(netWorthPointSchema),
});
export type NetWorthResponse = z.infer<typeof netWorthResponseSchema>;
