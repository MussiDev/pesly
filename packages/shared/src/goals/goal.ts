import { z } from 'zod';
import { accountCurrencySchema, boundedNameSchema } from '../accounts/account';
import { calendarDateSchema } from '../credit-cards/credit-card';
import { minorUnitsStringSchema } from '../money';
import { movementAmountSchema } from '../movements/movement';

export const GOAL_NAME_MAX_LENGTH = 80;
export const GOAL_ENTRIES_PAGE_SIZE_DEFAULT = 50;
export const GOAL_ENTRIES_PAGE_SIZE_MAX = 100;

export const goalNameSchema = boundedNameSchema(GOAL_NAME_MAX_LENGTH);

export const GOAL_ENTRY_KINDS = ['contribution', 'withdrawal'] as const;
export const goalEntryKindSchema = z.enum(GOAL_ENTRY_KINDS);
export type GoalEntryKind = z.infer<typeof goalEntryKindSchema>;

export const GOAL_STATUSES = ['active', 'reached', 'overdue'] as const;
export const goalStatusSchema = z.enum(GOAL_STATUSES);
export type GoalStatus = z.infer<typeof goalStatusSchema>;

/**
 * `POST /goals`. The link to an account is set only here and never changes (spec D4); that the
 * account exists, is the caller's and has the same currency is checked by the use case.
 */
export const createGoalRequestSchema = z.strictObject({
  name: goalNameSchema,
  targetAmount: movementAmountSchema,
  currency: accountCurrencySchema,
  targetDate: calendarDateSchema.optional(),
  accountId: z.uuid().optional(),
});

export type CreateGoalRequest = z.infer<typeof createGoalRequestSchema>;

/** `PATCH /goals/:id`: currency and link never change (spec D9); `targetDate: null` removes it. */
export const updateGoalRequestSchema = z
  .strictObject({
    name: goalNameSchema.optional(),
    targetAmount: movementAmountSchema.optional(),
    targetDate: calendarDateSchema.nullable().optional(),
  })
  .refine((request) => Object.keys(request).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateGoalRequest = z.infer<typeof updateGoalRequestSchema>;

/** `POST /goals/:id/entries`. */
export const createGoalEntryRequestSchema = z.strictObject({
  kind: goalEntryKindSchema,
  amount: movementAmountSchema,
});

export type CreateGoalEntryRequest = z.infer<typeof createGoalEntryRequestSchema>;

export const goalIdParamsSchema = z.strictObject({ id: z.uuid() });

export type GoalIdParams = z.infer<typeof goalIdParamsSchema>;

/** `GET /goals/:id/entries`; `limit` defaults to `GOAL_ENTRIES_PAGE_SIZE_DEFAULT` where applied. */
export const listGoalEntriesQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(GOAL_ENTRIES_PAGE_SIZE_MAX).optional(),
});

export type ListGoalEntriesQuery = z.infer<typeof listGoalEntriesQuerySchema>;

/** Money is a minor-units string; `progress` can be negative for a linked goal (overdrawn account). */
export const goalResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  targetAmount: minorUnitsStringSchema,
  currency: accountCurrencySchema,
  targetDate: calendarDateSchema.nullable(),
  accountId: z.uuid().nullable(),
  progress: minorUnitsStringSchema,
  percentage: z.number().int(),
  status: goalStatusSchema,
  monthlyAmountNeeded: minorUnitsStringSchema.nullable(),
  createdAt: z.string(),
});

export type GoalResponse = z.infer<typeof goalResponseSchema>;

export const listGoalsResponseSchema = z.object({ goals: z.array(goalResponseSchema) });

export type ListGoalsResponse = z.infer<typeof listGoalsResponseSchema>;

export const goalEntryResponseSchema = z.object({
  id: z.uuid(),
  kind: goalEntryKindSchema,
  amount: minorUnitsStringSchema,
  createdAt: z.string(),
});

export type GoalEntryResponse = z.infer<typeof goalEntryResponseSchema>;

export const recordGoalEntryResponseSchema = z.object({
  entry: goalEntryResponseSchema,
  goal: goalResponseSchema,
});

export type RecordGoalEntryResponse = z.infer<typeof recordGoalEntryResponseSchema>;

export const listGoalEntriesResponseSchema = z.object({
  entries: z.array(goalEntryResponseSchema),
});

export type ListGoalEntriesResponse = z.infer<typeof listGoalEntriesResponseSchema>;
