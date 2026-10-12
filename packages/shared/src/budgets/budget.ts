import { z } from 'zod';
import { ACCOUNT_CURRENCIES, boundedNameSchema } from '../accounts/account';
import { exactIntegerStringSchema } from '../money';
import { movementAmountSchema } from '../movements/movement';

export const BUDGET_NAME_MAX_LENGTH = 50;
export const BUDGET_LIMIT_PER_USER = 50;
export const BUDGET_MAX_CATEGORIES = 50;
export const BUDGET_MAX_THRESHOLDS = 5;
export const BUDGET_THRESHOLD_MIN_PERCENT = 1;
export const BUDGET_THRESHOLD_MAX_PERCENT = 200;
/** Applied when a request sends no thresholds (FR-04). */
export const BUDGET_DEFAULT_THRESHOLDS: readonly number[] = [80, 100];

export const budgetNameSchema = boundedNameSchema(BUDGET_NAME_MAX_LENGTH);

export const budgetCurrencySchema = z.enum(ACCOUNT_CURRENCIES);
export type BudgetCurrency = z.infer<typeof budgetCurrencySchema>;

/** 1 to 5 distinct integer percentages from 1 to 200; an empty list is not a budget without alerts. */
export const budgetThresholdsSchema = z
  .array(z.number().int().min(BUDGET_THRESHOLD_MIN_PERCENT).max(BUDGET_THRESHOLD_MAX_PERCENT))
  .min(1)
  .max(BUDGET_MAX_THRESHOLDS)
  .refine((values) => new Set(values).size === values.length, {
    message: 'Thresholds must be distinct',
  });

const budgetCategoryIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(BUDGET_MAX_CATEGORIES)
  .refine((values) => new Set(values).size === values.length, {
    message: 'Category ids must be distinct',
  });

/** `POST /budgets`. */
export const createBudgetRequestSchema = z.strictObject({
  name: budgetNameSchema,
  amount: movementAmountSchema,
  currency: budgetCurrencySchema,
  categoryIds: budgetCategoryIdsSchema,
  rollover: z.boolean().optional(),
  thresholds: budgetThresholdsSchema.optional(),
});
export type CreateBudgetRequest = z.infer<typeof createBudgetRequestSchema>;

/** `PATCH /budgets/:id`. A partial update; the currency is immutable, so it is an unknown key. */
export const updateBudgetRequestSchema = z
  .strictObject({
    name: budgetNameSchema.optional(),
    amount: movementAmountSchema.optional(),
    categoryIds: budgetCategoryIdsSchema.optional(),
    rollover: z.boolean().optional(),
    thresholds: budgetThresholdsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });
export type UpdateBudgetRequest = z.infer<typeof updateBudgetRequestSchema>;

export const budgetIdParamsSchema = z.object({ id: z.uuid() });
export type BudgetIdParams = z.infer<typeof budgetIdParamsSchema>;

export const budgetResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  amount: exactIntegerStringSchema,
  currency: budgetCurrencySchema,
  rollover: z.boolean(),
  thresholds: z.array(z.number().int()),
  /** The categories the user selected. */
  categoryIds: z.array(z.uuid()),
  /** The selected categories plus the subcategories of every selected parent. */
  coveredCategoryIds: z.array(z.uuid()),
  /** First day (`YYYY-MM-01`) of the month of the version in force. */
  effectiveFrom: z.iso.date(),
  createdAt: z.iso.datetime(),
});
export type BudgetResponse = z.infer<typeof budgetResponseSchema>;

export const budgetListResponseSchema = z.array(budgetResponseSchema);
export type BudgetListResponse = z.infer<typeof budgetListResponseSchema>;
