import { monthStartOf } from './month';

/** The thresholds at or below the percentage used, ascending; threshold N is crossed at N or more. */
export function crossedThresholds(thresholds: readonly number[], percentUsed: number): number[] {
  return thresholds.filter((threshold) => threshold <= percentUsed).sort((a, b) => a - b);
}

/** The first day of a `YYYY-MM` month, as `YYYY-MM-01`. */
export function monthStartDate(month: string): string {
  return monthStartOf(month);
}
