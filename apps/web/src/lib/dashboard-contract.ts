import { exactIntegerStringSchema } from '@pesly/shared';
import { z } from 'zod';

// PROVISIONAL (spec DISC-001-09c, D1): the 09b response is not merged yet, so this is the shape
// read from its PRD. When 09b merges, delete this file in favor of its shared schema and adjust
// only `features/dashboard/contract/dashboard-adapter.ts`. Nothing else may import it.

const currencySchema = z.enum(['ARS', 'USD']);
const amountSchema = exactIntegerStringSchema;
const wholeNumberSchema = z.number().int();
const countSchema = z.number().int().nonnegative();
const changeSchema = wholeNumberSchema.nullable();
const textSchema = z.string().nullable();

const entrySchema = z.object({
  kind: z.string().min(1),
  id: z.uuid().nullable(),
  name: textSchema,
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  amount: amountSchema.nullable(),
  currency: currencySchema.nullable(),
});

const perCurrencySchema = z.object({ ARS: amountSchema, USD: amountSchema });

export const dashboardResponseSchema = z.object({
  currency: currencySchema,
  netWorth: z.object({
    ars: amountSchema,
    usd: amountSchema,
    total: amountSchema.nullable(),
    reason: z.literal('no_rate').nullable(),
    holdingsWithoutPrice: countSchema,
  }),
  month: z.object({
    expenses: amountSchema,
    income: amountSchema,
    net: amountSchema,
    expensesChange: changeSchema,
    incomeChange: changeSchema,
    netChange: changeSchema,
    leftOutShares: countSchema,
    leftOutInstallments: countSchema,
  }),
  categories: z.array(
    z.object({
      categoryId: z.uuid().nullable(),
      defaultKey: textSchema,
      name: textSchema,
      amount: amountSchema,
      share: wholeNumberSchema,
    }),
  ),
  budgets: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      currency: currencySchema,
      percent: wholeNumberSchema,
      status: z.enum(['on_track', 'close', 'over']),
    }),
  ),
  upcoming: z.array(entrySchema),
  actions: z.array(entrySchema),
  groups: z.object({ owedToYou: perCurrencySchema, youOwe: perCurrencySchema }),
  insight: z
    .object({
      defaultKey: textSchema,
      name: textSchema,
      share: wholeNumberSchema,
      change: changeSchema,
    })
    .nullable(),
  firstSteps: z.object({
    hasAccount: z.boolean(),
    hasMovement: z.boolean(),
    show: z.boolean(),
  }),
});

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type DashboardEntry = z.infer<typeof entrySchema>;
