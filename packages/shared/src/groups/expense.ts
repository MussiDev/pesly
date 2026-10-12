import { z } from 'zod';
import { accountCurrencySchema, boundedNameSchema } from '../accounts/account';
import { movementAmountSchema, occurredAtSchema } from '../movements/movement';
import { BASIS_POINTS_TOTAL } from '../money/split-expense';
import { rateTypeSchema } from '../rate-types';
import { groupCategoryResponseSchema } from './group';

/** The member limit of a group (spec D13) bounds a split. */
export const GROUP_SPLIT_MEMBERS_MAX = 50;

export const GROUP_EXPENSE_DESCRIPTION_MAX_LENGTH = 200;
export const GROUP_EXPENSES_PAGE_SIZE_DEFAULT = 50;
export const GROUP_EXPENSES_PAGE_SIZE_MAX = 100;

export const GROUP_SPLIT_MODES = ['equal', 'percentage', 'exact'] as const;
export const groupSplitModeSchema = z.enum(GROUP_SPLIT_MODES);
export type GroupSplitMode = z.infer<typeof groupSplitModeSchema>;

/** The largest value of the PostgreSQL `integer` column that holds a record version (spec D1). */
export const GROUP_RECORD_VERSION_MAX = 2147483647;

/** The version a record has on the server; it starts at 1 and grows by 1 on every change. */
export const groupRecordVersionSchema = z.number().int().min(1).max(GROUP_RECORD_VERSION_MAX);

/** The version the client last saw; required on every change so nothing is overwritten silently (D2). */
export const baseVersionSchema = groupRecordVersionSchema;

/** `baseVersion` in a DELETE query string: coerced from text, then bounded like the body field. */
export const baseVersionQuerySchema = z.coerce.number().int().min(1).max(GROUP_RECORD_VERSION_MAX);

/** Same trimming and control-character rules as names, with the 1 to 200 bound of spec D13. */
export const groupExpenseDescriptionSchema = boundedNameSchema(
  GROUP_EXPENSE_DESCRIPTION_MAX_LENGTH,
);

/** A non-negative minor-units integer string with no leading zeros; zero shares are allowed. */
const shareAmountSchema = z
  .string()
  .regex(/^(0|[1-9]\d{0,15})$/, 'Amount must be a non-negative integer string')
  .refine((text) => BigInt(text) <= 10n ** 15n, { message: 'Amount is too large' });

const memberIdsUnique = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;

const UNIQUE_MEMBERS_MESSAGE = 'A member can appear only once in a split';

const basisPointsSchema = z.number().int().min(0).max(BASIS_POINTS_TOTAL);

const equalSplitSchema = z.strictObject({
  mode: z.literal('equal'),
  memberIds: z
    .array(z.uuid())
    .min(1)
    .max(GROUP_SPLIT_MEMBERS_MAX)
    .refine(memberIdsUnique, { message: UNIQUE_MEMBERS_MESSAGE }),
});

const percentageSharesSchema = z
  .array(z.strictObject({ memberId: z.uuid(), basisPoints: basisPointsSchema }))
  .min(1)
  .max(GROUP_SPLIT_MEMBERS_MAX)
  .refine((shares) => memberIdsUnique(shares.map((share) => share.memberId)), {
    message: UNIQUE_MEMBERS_MESSAGE,
  });

const percentageSplitSchema = z.strictObject({
  mode: z.literal('percentage'),
  shares: percentageSharesSchema,
});

const exactSplitSchema = z.strictObject({
  mode: z.literal('exact'),
  shares: z
    .array(z.strictObject({ memberId: z.uuid(), amount: shareAmountSchema }))
    .min(1)
    .max(GROUP_SPLIT_MEMBERS_MAX)
    .refine((shares) => memberIdsUnique(shares.map((share) => share.memberId)), {
      message: UNIQUE_MEMBERS_MESSAGE,
    }),
});

/**
 * How an expense is split (spec D4). That percentages total 10,000 and exact amounts total the
 * expense, and that members belong to the group, are checked by the use case, not here.
 */
export const splitSchema = z.discriminatedUnion('mode', [
  equalSplitSchema,
  percentageSplitSchema,
  exactSplitSchema,
]);

export type GroupSplit = z.infer<typeof splitSchema>;

/** `PUT /groups/:id/default-split`: `equal` means all current members, so it names none. */
export const defaultSplitRequestSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('equal') }),
  percentageSplitSchema,
]);

export type DefaultSplitRequest = z.infer<typeof defaultSplitRequestSchema>;

/** Present only when the caller is the payer: where and under which category the money left (D5). */
export const payerAccountSchema = z.strictObject({
  accountId: z.uuid(),
  categoryId: z.uuid(),
});

export type PayerAccount = z.infer<typeof payerAccountSchema>;

/** `POST /groups/:id/expenses`. */
export const createGroupExpenseRequestSchema = z.strictObject({
  amount: movementAmountSchema,
  currency: accountCurrencySchema,
  occurredAt: occurredAtSchema,
  payerMemberId: z.uuid(),
  categoryId: z.uuid(),
  description: groupExpenseDescriptionSchema,
  split: splitSchema,
  payerAccount: payerAccountSchema.optional(),
});

export type CreateGroupExpenseRequest = z.infer<typeof createGroupExpenseRequestSchema>;

/**
 * `PUT /groups/:id/expenses/:expenseId` (spec D2): a full replacement validated like creation.
 * Currency, payer, payer account and creator are fixed, so a body that names them is invalid.
 */
export const updateGroupExpenseRequestSchema = z.strictObject({
  amount: movementAmountSchema,
  occurredAt: occurredAtSchema,
  categoryId: z.uuid(),
  description: groupExpenseDescriptionSchema,
  split: splitSchema,
  baseVersion: baseVersionSchema,
});

export type UpdateGroupExpenseRequest = z.infer<typeof updateGroupExpenseRequestSchema>;

export const groupExpenseParamsSchema = z.object({ id: z.uuid(), expenseId: z.uuid() });

export type GroupExpenseParams = z.infer<typeof groupExpenseParamsSchema>;

/** `DELETE /groups/:id/expenses/:expenseId?baseVersion=N` (spec D2). */
export const deleteGroupExpenseQuerySchema = z.strictObject({
  baseVersion: baseVersionQuerySchema,
});

export type DeleteGroupExpenseQuery = z.infer<typeof deleteGroupExpenseQuerySchema>;

const pageLimitSchema = z.coerce.number().int().min(1).max(GROUP_EXPENSES_PAGE_SIZE_MAX).optional();

const cursorSchema = z.string().min(1).max(512).optional();

/** `GET /groups/:id/expenses`; `limit` defaults to 50 where it is applied. */
export const listGroupExpensesQuerySchema = z.strictObject({
  limit: pageLimitSchema,
  cursor: cursorSchema,
});

export type ListGroupExpensesQuery = z.infer<typeof listGroupExpensesQuerySchema>;

/** `GET /groups/personal/shares`; `from` and `to` are UTC instants. */
export const personalSharesQuerySchema = z.strictObject({
  from: occurredAtSchema.optional(),
  to: occurredAtSchema.optional(),
  limit: pageLimitSchema,
  cursor: cursorSchema,
});

export type PersonalSharesQuery = z.infer<typeof personalSharesQuerySchema>;

const amountStringSchema = z.string().regex(/^(0|[1-9]\d*)$/);

export const groupExpenseShareResponseSchema = z.object({
  memberId: z.string(),
  amount: amountStringSchema,
});

export type GroupExpenseShareResponse = z.infer<typeof groupExpenseShareResponseSchema>;

export const groupExpenseResponseSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  payerMemberId: z.string(),
  createdByMemberId: z.string(),
  amount: amountStringSchema,
  currency: accountCurrencySchema,
  occurredAt: z.iso.datetime(),
  categoryId: z.string(),
  description: z.string(),
  splitMode: groupSplitModeSchema,
  payerMovementId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  shares: z.array(groupExpenseShareResponseSchema),
  version: groupRecordVersionSchema,
});

export type GroupExpenseResponse = z.infer<typeof groupExpenseResponseSchema>;

/** Key of the default category a send uses when the request names none (spec D18). */
export const AUTOMATIC_SEND_CATEGORY_KEY = 'other-expenses';

/** Whether sending created the automatic category or restored an archived one. */
export const automaticCategoryChangeSchema = z.enum(['created', 'restored']);
export type AutomaticCategoryChange = z.infer<typeof automaticCategoryChangeSchema>;

/**
 * Sends an existing movement to a group as an expense: amount, currency, date and payer come from the
 * movement, so any other key (including a category name, key, icon or color) is invalid.
 */
export const sendMovementToGroupRequestSchema = z.strictObject({
  movementId: z.uuid(),
  categoryId: z.uuid().optional(),
  description: groupExpenseDescriptionSchema.optional(),
  split: splitSchema,
});

export type SendMovementToGroupRequest = z.infer<typeof sendMovementToGroupRequestSchema>;

export const sendMovementToGroupResponseSchema = groupExpenseResponseSchema.extend({
  autoCategory: automaticCategoryChangeSchema.nullable(),
});

export type SendMovementToGroupResponse = z.infer<typeof sendMovementToGroupResponseSchema>;

export const groupExpensePageSchema = z.object({
  items: z.array(groupExpenseResponseSchema),
  nextCursor: z.string().nullable(),
});

export type GroupExpensePage = z.infer<typeof groupExpensePageSchema>;

/** The default split as stored: `equal` carries no members (spec D8). */
export const defaultSplitResponseSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('equal') }),
  z.object({
    mode: z.literal('percentage'),
    shares: z.array(z.object({ memberId: z.string(), basisPoints: basisPointsSchema })),
  }),
]);

export type DefaultSplitResponse = z.infer<typeof defaultSplitResponseSchema>;

/** `GET /groups/:id/expense-options`: everything a new expense needs in one call (spec D9). */
export const expenseOptionsResponseSchema = z.object({
  /** The caller's own active member id in this group. */
  selfMemberId: z.string(),
  members: z.array(
    z.object({
      id: z.string(),
      displayName: z.string().nullable(),
      isGhost: z.boolean(),
      joinedAt: z.iso.datetime(),
    }),
  ),
  categories: z.array(groupCategoryResponseSchema),
  defaultSplit: defaultSplitResponseSchema,
  defaultRateType: rateTypeSchema,
});

export type ExpenseOptionsResponse = z.infer<typeof expenseOptionsResponseSchema>;

/** One expense of the caller's personal view (spec D7); amounts are never converted. */
export const personalShareResponseSchema = z.object({
  expenseId: z.string(),
  groupId: z.string(),
  currency: accountCurrencySchema,
  occurredAt: z.iso.datetime(),
  shareAmount: amountStringSchema,
  receivableAmount: amountStringSchema.nullable(),
});

export type PersonalShareResponse = z.infer<typeof personalShareResponseSchema>;

export const personalSharesPageSchema = z.object({
  items: z.array(personalShareResponseSchema),
  nextCursor: z.string().nullable(),
});

export type PersonalSharesPage = z.infer<typeof personalSharesPageSchema>;
