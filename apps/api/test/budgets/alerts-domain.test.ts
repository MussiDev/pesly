import { describe, expect, it } from 'vitest';
import { crossedThresholds, monthStartDate } from '../../src/budgets/domain/alerts';

describe('crossedThresholds', () => {
  it('returns the thresholds at or below the percentage, ascending', () => {
    expect(crossedThresholds([100, 80], 80)).toEqual([80]);
    expect(crossedThresholds([100, 80], 110)).toEqual([80, 100]);
    expect(crossedThresholds([90, 50], 55)).toEqual([50]);
  });

  it('returns nothing below the lowest threshold', () => {
    expect(crossedThresholds([80, 100], 79)).toEqual([]);
    expect(crossedThresholds([], 500)).toEqual([]);
  });

  it('crosses a threshold exactly when the percentage reaches it', () => {
    expect(crossedThresholds([200], 199)).toEqual([]);
    expect(crossedThresholds([200], 200)).toEqual([200]);
  });

  it('does not mutate its input', () => {
    const input = [100, 80];
    crossedThresholds(input, 100);
    expect(input).toEqual([100, 80]);
  });
});

describe('monthStartDate', () => {
  it('turns a YYYY-MM month into its first day', () => {
    expect(monthStartDate('2026-10')).toBe('2026-10-01');
  });

  it('rejects a malformed month', () => {
    expect(() => monthStartDate('2026-13')).toThrow(RangeError);
    expect(() => monthStartDate('2026-10-05')).toThrow(RangeError);
  });
});
