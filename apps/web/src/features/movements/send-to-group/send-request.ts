import {
  GROUP_EXPENSE_DESCRIPTION_MAX_LENGTH,
  groupExpenseDescriptionSchema,
  type SendMovementToGroupRequest,
} from '@pesly/shared';
import { buildSplit, type SplitFieldError } from '@/features/groups/split/split-request';
import type { SplitState } from '@/features/groups/split/split-state';
import { AUTOMATIC_CATEGORY } from './send-defaults';

const ERR = 'groups.expenses.form.errors';

export interface SendFormValues {
  description: string;
  /** `AUTOMATIC_CATEGORY` or the id of a group category. */
  category: string;
  split: SplitState;
}

export interface SendRequestContext {
  movementId: string;
  /** The movement's amount in minor units; never read back from text. */
  amount: bigint;
  /** Every active member of the group, in joining order. */
  memberIds: readonly string[];
  categories: readonly { id: string; archivedAt: string | null }[];
  locale: string;
}

export type SendFieldName = 'description' | 'category' | 'split';
/** A full catalog path per invalid field. */
export type SendFieldErrors = Partial<Record<SendFieldName, string>>;

export type SendRequestResult =
  | { request: SendMovementToGroupRequest; fields?: undefined; splitErrors?: undefined }
  | {
      request?: undefined;
      fields: SendFieldErrors;
      splitErrors?: SplitFieldError[];
      difference?: bigint | null;
    };

/** The note as a description: whitespace collapsed, at most 200 code points (not UTF-16 units). */
export function descriptionFromNote(note: string | null): string {
  if (note === null) return '';
  const collapsed = note.replace(/\s+/gu, ' ').trim();
  return Array.from(collapsed).slice(0, GROUP_EXPENSE_DESCRIPTION_MAX_LENGTH).join('').trim();
}

/** The body to send, or the per-field messages explaining why there is none. */
export function buildSendRequest(
  values: SendFormValues,
  context: SendRequestContext,
): SendRequestResult {
  const fields: SendFieldErrors = {};

  const description = values.description.trim();
  if (description === '') fields.description = `${ERR}.descriptionRequired`;
  else if (Array.from(description).length > GROUP_EXPENSE_DESCRIPTION_MAX_LENGTH) {
    fields.description = `${ERR}.descriptionTooLong`;
  } else if (!groupExpenseDescriptionSchema.safeParse(description).success) {
    fields.description = `${ERR}.descriptionInvalid`;
  }

  const automatic = values.category === AUTOMATIC_CATEGORY;
  if (
    !automatic &&
    !context.categories.some(
      (category) => category.id === values.category && category.archivedAt === null,
    )
  ) {
    fields.category = `${ERR}.categoryRequired`;
  }

  const { split: state } = values;
  const selected =
    state.mode === 'equal'
      ? state.selectedMemberIds
      : context.memberIds.filter((id) => (state.values[id] ?? '').trim() !== '');
  const result = buildSplit(
    { ...state, selectedMemberIds: [...selected], amount: context.amount },
    context.amount,
    state.payerMemberId,
    context.locale,
  );
  if (!result.ok) fields.split = result.errors[0]?.path;

  if (Object.keys(fields).length > 0 || !result.ok) {
    return {
      fields,
      ...(result.ok ? {} : { splitErrors: result.errors, difference: result.difference }),
    };
  }

  return {
    request: {
      movementId: context.movementId,
      ...(automatic ? {} : { categoryId: values.category }),
      description,
      split: result.split,
    },
  };
}
