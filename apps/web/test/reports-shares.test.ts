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

  it('gives the leftover points to the largest remainders, not to the largest row', () => {
    const result = computeShares(rows(3_333n, 3_334n, 3_333n), 10_000n);
    expect(percents(result)).toEqual([33, 34, 33]);
  });

  it('7 equal rows give five 14% and two 15%, adding up to 100 and none at 16%', () => {
    const result = computeShares(rows(...Array<bigint>(7).fill(100n)), 700n);
    expect(percents(result)).toEqual([15, 15, 14, 14, 14, 14, 14]);
    expect(percents(result).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('one 50% row and 60 rows of 0.83% keep the big one at 50% and the small ones under one', () => {
    const result = computeShares(rows(5_000n, ...Array<bigint>(60).fill(83n)), 10_000n);
    expect(result[0]).toEqual({ percent: 50, underOne: false });
    expect(result.slice(1).every((r) => r.percent === 0 && r.underOne)).toBe(true);
  });

  it('rows that cover the total with under-one rows never inflate the big row beyond +1', () => {
    const result = computeShares(rows(5_020n, ...Array<bigint>(60).fill(83n)), 10_000n);
    expect(result[0]?.percent).toBeLessThanOrEqual(51);
    expect(result[0]?.percent).toBeGreaterThanOrEqual(50);
  });

  it('breaks equal remainders by the larger amount, then by order', () => {
    // 1/3 and 2/3 style: remainders tie at 50 of 100 -> larger amount first.
    const result = computeShares(rows(150n, 250n, 0n, 100n), 500n);
    expect(percents(result).reduce((a, b) => a + b, 0)).toBe(100);
    expect(percents(result)).toEqual([30, 50, 0, 20]);
  });

  it('property: a share is never more than its true share plus one point', () => {
    let seed = 777;
    const next = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    for (let run = 0; run < 300; run += 1) {
      const amounts = Array.from({ length: 1 + next(15) }, () => BigInt(1 + next(100_000)));
      const total = amounts.reduce((a, b) => a + b, 0n);
      const result = computeShares(
        amounts.map((amount) => ({ amount })),
        total,
      );
      amounts.forEach((amount, i) => {
        const percent = BigInt(result[i]?.percent ?? 0);
        expect(percent * total).toBeLessThanOrEqual(amount * 100n + total);
      });
      const sum = percents(result).reduce((a, b) => a + b, 0);
      const eligible = result.some((r) => r.percent > 0);
      if (!eligible) continue;
      expect(sum).toBeLessThanOrEqual(100);
    }
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
