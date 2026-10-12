import { exactIntegerStringSchema } from '@pesly/shared';
import { z } from 'zod';

// Local copy of the `GET /dashboard` response of spec DISC-001-09b
// (`packages/shared/src/dashboard/dashboard.ts` on that branch), aligned on 2026-10-12. Once 09b
// is merged, delete this file in favor of the shared schema; only `contract/dashboard-adapter.ts`
// and `api-client.ts` import it. Parsing is not strict about extra keys, so a field 09b adds later
// does not break the screen.

const currencySchema = z.enum(['ARS', 'USD']);
const amountSchema = exactIntegerStringSchema;
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const countSchema = z.number().int().min(0);
const PERCENT_LIMIT = 1_000_000;
const percentChangeSchema = z.number().int().min(-PERCENT_LIMIT).max(PERCENT_LIMIT).nullable();
const sharePercentSchema = z.number().int().min(0).max(100);

const currencyAmountsSchema = z.object({ ars: amountSchema, usd: amountSchema });

const netWorthSchema = z
  .object({
    ars: amountSchema,
    usd: amountSchema,
    total: amountSchema.nullable(),
    reason: z.literal('no_rate').nullable(),
    holdingsWithoutPrice: countSchema,
    parts: z.object({
      accounts: currencyAmountsSchema,
      investments: currencyAmountsSchema,
      groups: currencyAmountsSchema,
      installmentDebt: currencyAmountsSchema,
    }),
  })
  .refine((netWorth) => (netWorth.total === null) === (netWorth.reason !== null), {
    message: 'Exactly one of total and reason must be set',
  });

const upcomingSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('recurring_payment'),
    paymentId: z.uuid(),
    date: localDateSchema,
    name: z.string(),
    currency: currencySchema,
    amount: amountSchema,
  }),
  z.object({
    kind: z.literal('card_statement'),
    cardId: z.uuid(),
    statementId: z.uuid(),
    date: localDateSchema,
    name: z.string(),
    currency: currencySchema,
    amount: amountSchema,
  }),
]);

const actionSchema = z.discriminatedUnion('kind', [
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

export const dashboardResponseSchema = z.object({
  currency: currencySchema,
  today: localDateSchema,
  netWorth: netWorthSchema,
  month: z.object({
    from: localDateSchema,
    to: localDateSchema,
    expenses: amountSchema,
    income: amountSchema,
    net: amountSchema,
    change: z.object({
      expenses: percentChangeSchema,
      income: percentChangeSchema,
      net: percentChangeSchema,
    }),
    unconvertedShareCount: countSchema,
    unconvertedInstallmentCount: countSchema,
  }),
  categories: z.array(
    z.object({
      categoryId: z.uuid().nullable(),
      name: z.string().nullable(),
      defaultKey: z.string().nullable(),
      amount: amountSchema,
      sharePercent: sharePercentSchema,
    }),
  ),
  budgets: z
    .array(
      z.object({
        budgetId: z.uuid(),
        name: z.string(),
        currency: currencySchema,
        available: amountSchema,
        spent: amountSchema,
        percentUsed: z.number().int().min(0).max(1_000),
        status: z.enum(['on_track', 'close', 'over']),
      }),
    )
    .max(3),
  upcoming: z.array(upcomingSchema).max(20),
  actions: z.array(actionSchema).max(20),
  groups: z.object({ owedToYou: currencyAmountsSchema, youOwe: currencyAmountsSchema }),
  insight: z
    .object({
      categoryId: z.uuid().nullable(),
      name: z.string().nullable(),
      defaultKey: z.string().nullable(),
      amount: amountSchema,
      sharePercent: sharePercentSchema,
      changePercent: percentChangeSchema,
    })
    .nullable(),
  firstSteps: z.object({ hasAccount: z.boolean(), hasMovement: z.boolean(), show: z.boolean() }),
});

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type DashboardUpcoming = DashboardResponse['upcoming'][number];
export type DashboardAction = DashboardResponse['actions'][number];
