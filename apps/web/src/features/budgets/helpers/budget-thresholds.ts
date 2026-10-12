import {
  BUDGET_MAX_THRESHOLDS,
  BUDGET_THRESHOLD_MAX_PERCENT,
  BUDGET_THRESHOLD_MIN_PERCENT,
} from '@pesly/shared';

export type ThresholdError =
  | 'budgets.form.errors.thresholdInvalid'
  | 'budgets.form.errors.thresholdDuplicate'
  | 'budgets.form.errors.thresholdsTooMany';

export type AddThresholdResult =
  { list: number[]; error?: undefined } | { list?: undefined; error: ThresholdError };

function ascending(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

export function canAddThreshold(list: readonly number[]): boolean {
  return list.length < BUDGET_MAX_THRESHOLDS;
}

/** Digits only, a whole number in range and not already present; the list stays ascending. */
export function addThreshold(list: readonly number[], text: string): AddThresholdResult {
  if (!canAddThreshold(list)) return { error: 'budgets.form.errors.thresholdsTooMany' };
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return { error: 'budgets.form.errors.thresholdInvalid' };
  const value = Number.parseInt(trimmed, 10);
  if (value < BUDGET_THRESHOLD_MIN_PERCENT || value > BUDGET_THRESHOLD_MAX_PERCENT) {
    return { error: 'budgets.form.errors.thresholdInvalid' };
  }
  if (list.includes(value)) return { error: 'budgets.form.errors.thresholdDuplicate' };
  return { list: ascending([...list, value]) };
}

export function removeThreshold(list: readonly number[], value: number): number[] {
  return list.filter((item) => item !== value);
}

export { ascending as sortThresholds };
