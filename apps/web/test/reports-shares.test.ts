import { describe, expect, it } from 'vitest';
import { computeShares } from '../src/features/reports/shares';

const rows = (...amounts: bigint[]) => amounts.map((amount) => ({ amount }));
const percents = (result: ReturnType<typeof computeShares>) => result.map((r) => r.percent);

describe('computeShares (FR-04)', () => {
  it('120,000.00 and 80,000.00 of 200,000.00 give 60% and 40% (AC-08)', () => {
    const result = computeShares(rows(12_000_000n, 8_000_000n), 20_000_000n);
    expect(percents(result)).toEqual([60, 40]);
    expect(result.map((r) => r.underOne)).toEqual([false, false]);
  });

  it('thirds 33.34, 33.33 and 33.33 of 100.00 give 34, 33, 33 by integer arithmetic (AC-09)', () => {
    const result = computeShares(rows(3_334n, 3_333n, 3_333n), 10_000n);
    expect(percents(result)).toEqual([34, 33, 33]);
    expect(percents(result).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('gives the leftover to the largest row, not to the first one', () => {
    const result = computeShares(rows(3_333n, 3_334n, 3_333n), 10_000n);
    expect(percents(result)).toEqual([33, 34, 33]);
  });

  it('flags a row of 0.4% as under one and keeps its amount (AC-12)', () => {
    const result = computeShares(rows(9_960n, 40n), 10_000n);
    expect(result[1]).toEqual({ percent: 0, underOne: true });
    expect(percents(result)).toEqual([100, 0]);
  });

  it('shows 0% and no under-one flag for a row of 0 or less', () => {
    const result = computeShares(rows(10_000n, 0n, -500n), 10_000n);
    expect(result.slice(1)).toEqual([
      { percent: 0, underOne: false },
      { percent: 0, underOne: false },
    ]);
  });

  it('error: a total of 0.00 or a negative total gives no shares and never divides (AC-10)', () => {
    expect(computeShares(rows(0n, 0n), 0n)).toEqual([]);
    expect(computeShares(rows(500n), -100n)).toEqual([]);
    expect(computeShares([], 0n)).toEqual([]);
  });

  it('property: shares never exceed 100 in total and are never negative', () => {
    let seed = 12345;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    for (let run = 0; run < 500; run += 1) {
      const count = 1 + next(12);
      const amounts = Array.from({ length: count }, () => BigInt(next(2_000_000) - 200_000));
      const total = BigInt(next(5_000_000) - 100_000);
      const result = computeShares(
        amounts.map((amount) => ({ amount })),
        total,
      );
      if (result.length === 0) continue;
      expect(result).toHaveLength(count);
      const sum = percents(result).reduce((a, b) => a + b, 0);
      expect(sum).toBeLessThanOrEqual(100);
      for (const share of result) expect(share.percent).toBeGreaterThanOrEqual(0);
    }
  });
});
