import { z } from 'zod';
import { ACCOUNT_CURRENCIES } from '../accounts/account';
import { exactIntegerStringSchema } from '../money';
import { localDateSchema } from '../movements/movement-filters';

const dashboardCurrencySchema = z.enum(ACCOUNT_CURRENCIES);

export const DASHBOARD_MAX_BUDGETS = 3;
export const DASHBOARD_MAX_UPCOMING = 20;
export const DASHBOARD_MAX_ACTIONS = 20;
/** Bound of the whole-number percentages, so the JSON number stays exact. */
export const DASHBOARD_PERCENT_LIMIT = 1_000_000;
export const DASHBOARD_MAX_PERCENT_USED = 1_000;

export const BUDGET_STATUSES = ['on_track', 'close', 'over'] as const;
export const ACTION_KINDS = [
  'overdue_occurrence',
  'pending_occurrence',
  'unpaid_statement',
] as const;

/** `GET /dashboard` takes no parameter at all. */
export const dashboardQuerySchema = z.strictObject({});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

const currencyAmountsSchema = z.object({
  ars: exactIntegerStringSchema,
  usd: exactIntegerStringSchema,
});
export type DashboardCurrencyAmounts = z.infer<typeof currencyAmountsSchema>;

const percentChangeSchema = z
  .number()
  .int()
  .min(-DASHBOARD_PERCENT_LIMIT)
  .max(DASHBOARD_PERCENT_LIMIT)
  .nullable();

const sharePercentSchema = z.number().int().min(0).max(100);

/**
 * `ars` and `usd` are in their own currencies; `total` is in the display currency. Exactly one of
 * `total` and `reason` is set.
 */
export const dashboardNetWorthSchema = z
  .object({
    ars: exactIntegerStringSchema,
    usd: exactIntegerStringSchema,
    total: exactIntegerStringSchema.nullable(),
    reason: z.literal('no_rate').nullable(),
    holdingsWithoutPrice: z.number().int().min(0),
    parts: z.object({
      accounts: currencyAmountsSchema,
      investments: currencyAmountsSchema,
      groups: currencyAmountsSchema,
      /** A positive amount that is subtracted. */
      installmentDebt: currencyAmountsSchema,
    }),
  })
  .refine((netWorth) => (netWorth.total === null) === (netWorth.reason !== null), {
    message: 'Exactly one of total and reason must be set',
  });
export type DashboardNetWorth = z.infer<typeof dashboardNetWorthSchema>;

export const dashboardMonthSchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  expenses: exactIntegerStringSchema,
  income: exactIntegerStringSchema,
  net: exactIntegerStringSchema,
  change: z.object({
    expenses: percentChangeSchema,
    income: percentChangeSchema,
    net: percentChangeSchema,
  }),
  unconvertedShareCount: z.number().int().min(0),
  unconvertedInstallmentCount: z.number().int().min(0),
});
export type DashboardMonth = z.infer<typeof dashboardMonthSchema>;

export const dashboardCategorySchema = z.object({
  /** Null for the shares that match no personal category. */
  categoryId: z.uuid().nullable(),
  name: z.string().nullable(),
  defaultKey: z.string().nullable(),
  amount: exactIntegerStringSchema,
  sharePercent: sharePercentSchema,
});
export type DashboardCategory = z.infer<typeof dashboardCategorySchema>;

export const dashboardBudgetSchema = z.object({
  budgetId: z.uuid(),
  name: z.string(),
  currency: dashboardCurrencySchema,
  available: exactIntegerStringSchema,
  spent: exactIntegerStringSchema,
  percentUsed: z.number().int().min(0).max(DASHBOARD_MAX_PERCENT_USED),
  status: z.enum(BUDGET_STATUSES),
});
export type DashboardBudget = z.infer<typeof dashboardBudgetSchema>;

export const dashboardUpcomingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('recurring_payment'),
    paymentId: z.uuid(),
    date: localDateSchema,
    name: z.string(),
    currency: dashboardCurrencySchema,
    amount: exactIntegerStringSchema,
  }),
  z.object({
    kind: z.literal('card_statement'),
    cardId: z.uuid(),
    statementId: z.uuid(),
    date: localDateSchema,
    name: z.string(),
    currency: dashboardCurrencySchema,
    amount: exactIntegerStringSchema,
  }),
]);
export type DashboardUpcoming = z.infer<typeof dashboardUpcomingSchema>;

export const dashboardActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('overdue_occurrence'),
    dueDate: localDateSchema,
    name: z.string(),
    occurrenceId: z.uuid(),
  }),
  z.object({
    kind: z.literal('pending_occurrence'),
    dueDate: localDateSchema,
    name: z.string(),
    occurrenceId: z.uuid(),
  }),
  z.object({
    kind: z.literal('unpaid_statement'),
    dueDate: localDateSchema,
    name: z.string(),
    statementId: z.uuid(),
    cardId: z.uuid(),
  }),
]);
export type DashboardAction = z.infer<typeof dashboardActionSchema>;

export const dashboardInsightSchema = z.object({
  categoryId: z.uuid().nullable(),
  name: z.string().nullable(),
  defaultKey: z.string().nullable(),
  amount: exactIntegerStringSchema,
  sharePercent: sharePercentSchema,
  changePercent: percentChangeSchema,
});
export type DashboardInsight = z.infer<typeof dashboardInsightSchema>;

export const dashboardFirstStepsSchema = z.object({
  hasAccount: z.boolean(),
  hasMovement: z.boolean(),
  show: z.boolean(),
});
export type DashboardFirstSteps = z.infer<typeof dashboardFirstStepsSchema>;

export const dashboardResponseSchema = z.object({
  currency: dashboardCurrencySchema,
  today: localDateSchema,
  netWorth: dashboardNetWorthSchema,
  month: dashboardMonthSchema,
  categories: z.array(dashboardCategorySchema),
  budgets: z.array(dashboardBudgetSchema).max(DASHBOARD_MAX_BUDGETS),
  upcoming: z.array(dashboardUpcomingSchema).max(DASHBOARD_MAX_UPCOMING),
  actions: z.array(dashboardActionSchema).max(DASHBOARD_MAX_ACTIONS),
  groups: z.object({
    owedToYou: currencyAmountsSchema,
    youOwe: currencyAmountsSchema,
  }),
  insight: dashboardInsightSchema.nullable(),
  firstSteps: dashboardFirstStepsSchema,
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
