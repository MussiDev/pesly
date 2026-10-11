import { z } from 'zod';
import { accountCurrencySchema } from '../accounts/account';
import { minorUnitsStringSchema } from '../money';
import {
  GROUP_EXPENSES_PAGE_SIZE_DEFAULT,
  GROUP_EXPENSES_PAGE_SIZE_MAX,
  groupExpenseDescriptionSchema,
  groupSplitModeSchema,
} from './expense';

export const GROUP_ACTIVITY_PAGE_SIZE_DEFAULT = GROUP_EXPENSES_PAGE_SIZE_DEFAULT;
export const GROUP_ACTIVITY_PAGE_SIZE_MAX = GROUP_EXPENSES_PAGE_SIZE_MAX;

export const GROUP_ACTIVITY_ACTIONS = [
  'expense_created',
  'expense_updated',
  'expense_deleted',
  'settlement_created',
  'settlement_updated',
  'settlement_deleted',
] as const;
export const groupActivityActionSchema = z.enum(GROUP_ACTIVITY_ACTIONS);
export type GroupActivityAction = z.infer<typeof groupActivityActionSchema>;

export const GROUP_ACTIVITY_SUBJECT_TYPES = ['expense', 'settlement'] as const;
export const groupActivitySubjectTypeSchema = z.enum(GROUP_ACTIVITY_SUBJECT_TYPES);
export type GroupActivitySubjectType = z.infer<typeof groupActivitySubjectTypeSchema>;

/**
 * Every amount of a snapshot is a JSON string of a signed 64-bit integer in minor units (spec D7,
 * NFR-02): a JSON number or a decimal string is invalid, so nothing can lose precision.
 */
const amountSchema = minorUnitsStringSchema;

export const expenseSnapshotSchema = z.strictObject({
  amount: amountSchema,
  currency: accountCurrencySchema,
  occurredAt: z.iso.datetime(),
  categoryId: z.string(),
  description: groupExpenseDescriptionSchema,
  splitMode: groupSplitModeSchema,
  payerMemberId: z.string(),
  shares: z.array(z.strictObject({ memberId: z.string(), amount: amountSchema })),
});

export type ExpenseSnapshot = z.infer<typeof expenseSnapshotSchema>;

export const settlementSnapshotSchema = z.strictObject({
  fromMemberId: z.string(),
  toMemberId: z.string(),
  currency: accountCurrencySchema,
  amount: amountSchema,
  occurredAt: z.iso.datetime(),
  legs: z.array(z.strictObject({ currency: accountCurrencySchema, amount: amountSchema })),
});

export type SettlementSnapshot = z.infer<typeof settlementSnapshotSchema>;

const snapshotSchema = z.union([expenseSnapshotSchema, settlementSnapshotSchema]);

/** One log row (spec D9); creations carry no snapshots and a deletion carries no `after`. */
export const activityEntrySchema = z.strictObject({
  id: z.string(),
  action: groupActivityActionSchema,
  subjectType: groupActivitySubjectTypeSchema,
  subjectId: z.string(),
  memberId: z.string(),
  createdAt: z.iso.datetime(),
  before: snapshotSchema.nullable(),
  after: snapshotSchema.nullable(),
});

export type ActivityEntry = z.infer<typeof activityEntrySchema>;

export const activityPageSchema = z.object({
  items: z.array(activityEntrySchema),
  nextCursor: z.string().nullable(),
});

export type ActivityPage = z.infer<typeof activityPageSchema>;

/** `GET /groups/:id/activity`; `limit` defaults to 50 where it is applied. */
export const listActivityQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(GROUP_ACTIVITY_PAGE_SIZE_MAX).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

export type ListActivityQuery = z.infer<typeof listActivityQuerySchema>;
