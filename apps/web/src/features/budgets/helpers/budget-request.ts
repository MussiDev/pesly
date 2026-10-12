import {
  BUDGET_DEFAULT_THRESHOLDS,
  BUDGET_MAX_CATEGORIES,
  BUDGET_MAX_THRESHOLDS,
  BUDGET_NAME_MAX_LENGTH,
  BUDGET_THRESHOLD_MAX_PERCENT,
  BUDGET_THRESHOLD_MIN_PERCENT,
  movementAmountSchema,
  parseAmountInput,
  type BudgetResponse,
  type CreateBudgetRequest,
  type UpdateBudgetRequest,
} from '@pesly/shared';
import { sortThresholds } from './budget-thresholds';

export type BudgetFieldName = 'name' | 'amount' | 'categoryIds' | 'thresholds';

export type BudgetFieldMessage =
  | 'budgets.form.errors.nameRequired'
  | 'budgets.form.errors.nameTooLong'
  | 'budgets.form.errors.amountInvalid'
  | 'budgets.form.errors.categoriesRequired'
  | 'budgets.form.errors.thresholdsRequired';

export type BudgetFieldErrors = Partial<Record<BudgetFieldName, BudgetFieldMessage>>;

/** Everything as typed or selected; the amount is text, thresholds are already whole numbers. */
export interface BudgetFormState {
  name: string;
  amount: string;
  currency: CreateBudgetRequest['currency'];
  categoryIds: string[];
  rollover: boolean;
  thresholds: number[];
}

export type CreateBudgetResult =
  | { request: CreateBudgetRequest; errors?: undefined }
  | { request?: undefined; errors: BudgetFieldErrors };

export type UpdateBudgetResult =
  | { request: UpdateBudgetRequest; errors?: undefined; unchanged?: undefined }
  | { request?: undefined; errors: BudgetFieldErrors; unchanged?: undefined }
  | { request?: undefined; errors?: undefined; unchanged: true };

/** A fresh copy, so an editor can change its list without touching the shared default. */
export function defaultThresholds(): number[] {
  return [...BUDGET_DEFAULT_THRESHOLDS];
}

/** Minor units as the request string, or null when empty, not positive, malformed or too large. */
function amountText(text: string, locale: string): string | null {
  const value = parseAmountInput(text, locale);
  if (value === null || value <= 0n) return null;
  const parsed = movementAmountSchema.safeParse(value.toString());
  return parsed.success ? parsed.data : null;
}

function nameError(name: string): BudgetFieldMessage | null {
  const length = Array.from(name).length;
  if (length < 1) return 'budgets.form.errors.nameRequired';
  if (length > BUDGET_NAME_MAX_LENGTH) return 'budgets.form.errors.nameTooLong';
  return null;
}

function categoriesValid(ids: readonly string[]): boolean {
  return ids.length >= 1 && ids.length <= BUDGET_MAX_CATEGORIES && new Set(ids).size === ids.length;
}

function thresholdsValid(list: readonly number[]): boolean {
  return (
    list.length >= 1 &&
    list.length <= BUDGET_MAX_THRESHOLDS &&
    new Set(list).size === list.length &&
    list.every(
      (value) =>
        Number.isInteger(value) &&
        value >= BUDGET_THRESHOLD_MIN_PERCENT &&
        value <= BUDGET_THRESHOLD_MAX_PERCENT,
    )
  );
}

interface CheckedFields {
  name: string;
  amount: string | null;
  errors: BudgetFieldErrors;
}

function checkFields(state: BudgetFormState, locale: string): CheckedFields {
  const name = state.name.trim();
  const amount = amountText(state.amount, locale);
  const errors: BudgetFieldErrors = {};
  const nameMessage = nameError(name);
  if (nameMessage !== null) errors.name = nameMessage;
  if (amount === null) errors.amount = 'budgets.form.errors.amountInvalid';
  if (!categoriesValid(state.categoryIds)) {
    errors.categoryIds = 'budgets.form.errors.categoriesRequired';
  }
  if (!thresholdsValid(state.thresholds)) {
    errors.thresholds = 'budgets.form.errors.thresholdsRequired';
  }
  return { name, amount, errors };
}

export function buildCreateBudget(state: BudgetFormState, locale: string): CreateBudgetResult {
  const { name, amount, errors } = checkFields(state, locale);
  if (amount === null || Object.keys(errors).length > 0) return { errors };
  return {
    request: {
      name,
      amount,
      currency: state.currency,
      categoryIds: [...state.categoryIds],
      rollover: state.rollover,
      thresholds: sortThresholds(state.thresholds),
    },
  };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function sameList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Only changed values are sent; the currency is never sent (it is immutable). */
export function buildUpdateBudget(
  state: BudgetFormState,
  original: BudgetResponse,
  locale: string,
): UpdateBudgetResult {
  const { name, amount, errors } = checkFields(state, locale);
  if (amount === null || Object.keys(errors).length > 0) return { errors };

  const request: UpdateBudgetRequest = {};
  if (name !== original.name) request.name = name;
  if (BigInt(amount) !== BigInt(original.amount)) request.amount = amount;
  if (!sameSet(state.categoryIds, original.categoryIds)) {
    request.categoryIds = [...state.categoryIds];
  }
  if (state.rollover !== original.rollover) request.rollover = state.rollover;
  const thresholds = sortThresholds(state.thresholds);
  if (!sameList(thresholds, sortThresholds(original.thresholds))) request.thresholds = thresholds;
  if (Object.keys(request).length === 0) return { unchanged: true };
  return { request };
}
