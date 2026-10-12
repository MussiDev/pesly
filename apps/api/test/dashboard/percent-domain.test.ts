import { describe, expect, it } from 'vitest';
import {
  changePercent,
  insightChange,
  toJsonInt,
  wholePercent,
} from '../../src/dashboard/domain/percent';

describe('wholePercent', () => {
  it('truncates part over total toward zero', () => {
    expect(wholePercent(120n, 200n)).toBe(60n);
    expect(wholePercent(1n, 3n)).toBe(33n);
  });

  it('is 0 when the total is not positive', () => {
    expect(wholePercent(5n, 0n)).toBe(0n);
    expect(wholePercent(5n, -10n)).toBe(0n);
  });
});

describe('changePercent', () => {
  it('is the whole-number change against the previous value', () => {
    expect(changePercent(24_000_000n, 20_000_000n)).toBe(20n);
    expect(changePercent(10n, 20n)).toBe(-50n);
  });

  it('is null for a zero previous value', () => {
    expect(changePercent(5n, 0n)).toBeNull();
  });

  it('truncates toward zero on both sides', () => {
    expect(changePercent(399n, 300n)).toBe(33n);
    expect(changePercent(299n, 300n)).toBe(0n);
    expect(changePercent(250n, 300n)).toBe(-16n);
  });

  it('clamps at 1,000,000 in both directions', () => {
    expect(changePercent(10_000_000_000n, 1n)).toBe(1_000_000n);
    expect(changePercent(-10_000_000_000n, 1n)).toBe(-1_000_000n);
  });

  it('divides by the absolute value of a negative previous value', () => {
    expect(changePercent(100n, -200n)).toBe(150n);
    expect(changePercent(-100n, -200n)).toBe(50n);
    expect(changePercent(-300n, -200n)).toBe(-50n);
  });
});

describe('insightChange', () => {
  it('compares the month with the average of the three previous months', () => {
    expect(insightChange(140n, 300n)).toBe(40n);
    expect(insightChange(50n, 300n)).toBe(-50n);
  });

  it('is null when the three-month sum is not positive', () => {
    expect(insightChange(10n, 0n)).toBeNull();
    expect(insightChange(10n, -5n)).toBeNull();
  });

  it('clamps at 1,000,000', () => {
    expect(insightChange(10_000_000_000n, 1n)).toBe(1_000_000n);
  });
});

describe('toJsonInt', () => {
  it('turns a bounded bigint into a JSON number', () => {
    expect(toJsonInt(40n)).toBe(40);
    expect(toJsonInt(-1_000_000n)).toBe(-1_000_000);
  });

  it('refuses a bigint a JSON number cannot hold exactly', () => {
    expect(() => toJsonInt(2n ** 60n)).toThrow(RangeError);
  });
});
