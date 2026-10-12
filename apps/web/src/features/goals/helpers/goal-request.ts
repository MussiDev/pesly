import {
  GOAL_NAME_MAX_LENGTH,
  calendarDateSchema,
  movementAmountSchema,
  parseAmountInput,
  type CreateGoalEntryRequest,
  type CreateGoalRequest,
  type GoalEntryKind,
  type GoalResponse,
  type UpdateGoalRequest,
} from '@pesly/shared';

export type GoalFieldName = 'name' | 'targetAmount' | 'targetDate';

export type GoalFieldMessage =
  | 'goals.form.errors.nameRequired'
  | 'goals.form.errors.nameTooLong'
  | 'goals.form.errors.amountInvalid'
  | 'goals.form.errors.dateInvalid';

export type GoalFieldErrors = Partial<Record<GoalFieldName, GoalFieldMessage>>;

export const ENTRY_AMOUNT_ERROR = 'goals.entries.errors.amountInvalid';

/** Everything is text, as typed or selected; an empty date or account means none. */
export interface GoalFormState {
  name: string;
  targetAmount: string;
  currency: CreateGoalRequest['currency'];
  targetDate: string;
  accountId: string;
}

export type CreateGoalResult =
  | { request: CreateGoalRequest; errors?: undefined }
  | { request?: undefined; errors: GoalFieldErrors };

export type UpdateGoalResult =
  | { request: UpdateGoalRequest; errors?: undefined; unchanged?: undefined }
  | { request?: undefined; errors: GoalFieldErrors; unchanged?: undefined }
  | { request?: undefined; errors?: undefined; unchanged: true };

export type EntryResult =
  | { request: CreateGoalEntryRequest; error?: undefined }
  | { request?: undefined; error: typeof ENTRY_AMOUNT_ERROR };

/** Minor units as the request string, or null when empty, not positive, malformed or too large. */
function amountText(text: string, locale: string): string | null {
  const value = parseAmountInput(text, locale);
  if (value === null || value <= 0n) return null;
  const parsed = movementAmountSchema.safeParse(value.toString());
  return parsed.success ? parsed.data : null;
}

function nameError(name: string): GoalFieldMessage | null {
  const length = Array.from(name).length;
  if (length < 1) return 'goals.form.errors.nameRequired';
  if (length > GOAL_NAME_MAX_LENGTH) return 'goals.form.errors.nameTooLong';
  return null;
}

function dateError(date: string): GoalFieldMessage | null {
  return date === '' || calendarDateSchema.safeParse(date).success
    ? null
    : 'goals.form.errors.dateInvalid';
}

interface CheckedFields {
  name: string;
  amount: string | null;
  errors: GoalFieldErrors;
}

function checkFields(state: GoalFormState, locale: string): CheckedFields {
  const name = state.name.trim();
  const amount = amountText(state.targetAmount, locale);
  const errors: GoalFieldErrors = {};
  const nameMessage = nameError(name);
  if (nameMessage !== null) errors.name = nameMessage;
  if (amount === null) errors.targetAmount = 'goals.form.errors.amountInvalid';
  const dateMessage = dateError(state.targetDate);
  if (dateMessage !== null) errors.targetDate = dateMessage;
  return { name, amount, errors };
}

export function buildCreateGoal(state: GoalFormState, locale: string): CreateGoalResult {
  const { name, amount, errors } = checkFields(state, locale);
  if (amount === null || Object.keys(errors).length > 0) return { errors };

  const request: CreateGoalRequest = { name, targetAmount: amount, currency: state.currency };
  if (state.targetDate !== '') request.targetDate = state.targetDate;
  if (state.accountId !== '') request.accountId = state.accountId;
  return { request };
}

/** Only changed values are sent; a cleared date goes as `null`. */
export function buildUpdateGoal(
  state: GoalFormState,
  original: GoalResponse,
  locale: string,
): UpdateGoalResult {
  const { name, amount, errors } = checkFields(state, locale);
  if (amount === null || Object.keys(errors).length > 0) return { errors };

  const request: UpdateGoalRequest = {};
  if (name !== original.name) request.name = name;
  if (BigInt(amount) !== BigInt(original.targetAmount)) request.targetAmount = amount;
  if (state.targetDate !== (original.targetDate ?? '')) {
    request.targetDate = state.targetDate === '' ? null : state.targetDate;
  }
  if (Object.keys(request).length === 0) return { unchanged: true };
  return { request };
}

export function buildEntry(kind: GoalEntryKind, text: string, locale: string): EntryResult {
  const amount = amountText(text, locale);
  if (amount === null) return { error: ENTRY_AMOUNT_ERROR };
  return { request: { kind, amount } };
}
