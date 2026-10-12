import {
  AppError,
  BUDGET_DEFAULT_THRESHOLDS,
  BUDGET_MAX_THRESHOLDS,
  BUDGET_THRESHOLD_MAX_PERCENT,
  BUDGET_THRESHOLD_MIN_PERCENT,
} from '@pesly/shared';

/**
 * The thresholds a version stores: the defaults when none are sent, otherwise the input sorted
 * ascending. The shared contract rejects bad input first; this repeats the check so the rule holds
 * for any caller.
 */
export function normalizeThresholds(input?: readonly number[]): number[] {
  if (input === undefined) return [...BUDGET_DEFAULT_THRESHOLDS];
  const valid =
    input.length >= 1 &&
    input.length <= BUDGET_MAX_THRESHOLDS &&
    new Set(input).size === input.length &&
    input.every(
      (percent) =>
        Number.isInteger(percent) &&
        percent >= BUDGET_THRESHOLD_MIN_PERCENT &&
        percent <= BUDGET_THRESHOLD_MAX_PERCENT,
    );
  if (!valid) throw new AppError('VALIDATION_FAILED', 'Invalid thresholds', ['body.thresholds']);
  return [...input].sort((a, b) => a - b);
}
