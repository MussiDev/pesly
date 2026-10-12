import { z } from 'zod';
import { accountCurrencySchema } from '../accounts/account';
import { occurredAtSchema } from '../movements/movement';
import { groupCategoryResponseSchema } from './group';

export const GROUP_EXPENSE_RANGE_MAX_DAYS = 366;
export const GROUP_EXPENSE_CATEGORY_FILTER_MAX = 50;

const UUID_LENGTH = 36;
const CATEGORY_IDS_PARAM_MAX_LENGTH = GROUP_EXPENSE_CATEGORY_FILTER_MAX * (UUID_LENGTH + 1) - 1;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Comma-separated UUIDs (1 to 50, no repeats) that parse to a string array. */
export const categoryIdsParamSchema = z
  .string()
  .max(CATEGORY_IDS_PARAM_MAX_LENGTH)
  .transform((text) => text.split(','))
  .pipe(
    z
      .array(z.uuid())
      .min(1)
      .max(GROUP_EXPENSE_CATEGORY_FILTER_MAX)
      .refine((list) => new Set(list).size === list.length, { message: 'Repeated category id' }),
  );

/** Rejects `from > to` and a span above 366 days when both bounds are present. */
export function dateRangeRefinement(
  value: { from?: string | undefined; to?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.from === undefined || value.to === undefined) return;
  const span = Date.parse(value.to) - Date.parse(value.from);
  if (span < 0) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must not be before from' });
  } else if (span > GROUP_EXPENSE_RANGE_MAX_DAYS * DAY_MS) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: `The range is at most ${GROUP_EXPENSE_RANGE_MAX_DAYS} days`,
    });
  }
}

/** `GET /groups/:id/expenses/summary`; both bounds are required. */
export const groupExpenseSummaryQuerySchema = z
  .strictObject({ from: occurredAtSchema, to: occurredAtSchema })
  .superRefine(dateRangeRefinement);

export type GroupExpenseSummaryQuery = z.infer<typeof groupExpenseSummaryQuerySchema>;

const totalStringSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const countSchema = z.number().int().min(0);

export const groupExpenseSummaryCategoryLineSchema = z.object({
  categoryId: z.string(),
  total: totalStringSchema,
  count: countSchema,
});

export type GroupExpenseSummaryCategoryLine = z.infer<typeof groupExpenseSummaryCategoryLineSchema>;

export const groupExpenseSummaryCurrencySchema = z.object({
  currency: accountCurrencySchema,
  total: totalStringSchema,
  count: countSchema,
  categories: z.array(groupExpenseSummaryCategoryLineSchema),
});

export type GroupExpenseSummaryCurrency = z.infer<typeof groupExpenseSummaryCurrencySchema>;

export const groupExpenseSummaryResponseSchema = z.object({
  from: occurredAtSchema,
  to: occurredAtSchema,
  currencies: z.array(groupExpenseSummaryCurrencySchema),
  categories: z.array(groupCategoryResponseSchema),
});

export type GroupExpenseSummaryResponse = z.infer<typeof groupExpenseSummaryResponseSchema>;
