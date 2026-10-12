import { DASHBOARD_PERCENT_LIMIT } from '@pesly/shared';

const LIMIT = BigInt(DASHBOARD_PERCENT_LIMIT);

function clamp(value: bigint): bigint {
  if (value > LIMIT) return LIMIT;
  if (value < -LIMIT) return -LIMIT;
  return value;
}

/** `part` over `total` as a whole percentage truncated toward zero; 0 when the total is not positive. */
export function wholePercent(part: bigint, total: bigint): bigint {
  if (total <= 0n) return 0n;
  return (part * 100n) / total;
}

/**
 * The whole-number change from `previous` to `current`, truncated toward zero and clamped so the
 * JSON number stays exact. A negative previous value divides by its absolute value, so an
 * improvement is positive. Null when there is nothing to compare with.
 */
export function changePercent(current: bigint, previous: bigint): bigint | null {
  if (previous === 0n) return null;
  const base = previous < 0n ? -previous : previous;
  return clamp(((current - previous) * 100n) / base);
}

/** The change of a month against the average of the three months before it (`sum3 / 3`). */
export function insightChange(current: bigint, sum3: bigint): bigint | null {
  if (sum3 <= 0n) return null;
  return clamp(((current * 3n - sum3) * 100n) / sum3);
}

/** A bounded bigint as a JSON number; anything a double cannot hold exactly is an error. */
export function toJsonInt(value: bigint): number {
  const result = Number.parseInt(value.toString(), 10);
  if (!Number.isSafeInteger(result) || BigInt(result) !== value) {
    throw new RangeError('The value does not fit a JSON number');
  }
  return result;
}
