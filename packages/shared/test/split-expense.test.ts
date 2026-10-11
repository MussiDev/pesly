import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import {
  splitByBasisPoints,
  splitEqual,
  validateExactSplit,
  type BasisPointShare,
  type ExactShare,
} from '../src/money/split-expense';

const sum = (shares: Map<string, bigint>): bigint => {
  let total = 0n;
  for (const value of shares.values()) total += value;
  return total;
};

/** Seeded integer PRNG (64-bit LCG, bigint only): no floats, reproducible. */
function createRng(seed: bigint): (bound: bigint) => bigint {
  let state = seed;
  return (bound) => {
    state = (state * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
    return (state >> 16n) % bound;
  };
}

const compare = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

/** Differences between consecutive bounds: parts that add up to the last bound. */
const gaps = (bounds: readonly bigint[]): bigint[] =>
  bounds.slice(1).map((bound, i) => bound - (bounds[i] ?? 0n));

const ids = (count: number): string[] => Array.from({ length: count }, (_, i) => `m${i}`);

function catchError(action: () => unknown): AppError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('Expected the call to throw');
}

describe('splitEqual', () => {
  it('gives 10,000.00 each when 40,000.00 ARS is split among 4 (AC-07)', () => {
    const result = splitEqual(4_000_000n, ids(4));
    expect([...result.values()]).toEqual([1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n]);
  });

  it('gives 33.34 / 33.33 / 33.33 with the payer first (AC-12)', () => {
    const result = splitEqual(10_000n, ['payer', 'b', 'c']);
    expect(result.get('payer')).toBe(3_334n);
    expect(result.get('b')).toBe(3_333n);
    expect(result.get('c')).toBe(3_333n);
  });

  it('gives the leftover unit to the first member in order when the payer is outside (AC-13)', () => {
    const result = splitEqual(10_000n, ['first', 'second', 'third']);
    expect(result.get('first')).toBe(3_334n);
    expect(result.get('second')).toBe(3_333n);
    expect(result.get('third')).toBe(3_333n);
  });

  it('keeps the order of the supplied list', () => {
    expect([...splitEqual(10n, ['x', 'y', 'z']).keys()]).toEqual(['x', 'y', 'z']);
  });

  it('gives one unit each to the first members when the total is below the member count', () => {
    const result = splitEqual(2n, ids(5));
    expect([...result.values()]).toEqual([1n, 1n, 0n, 0n, 0n]);
  });

  it('rejects an empty member list, duplicated members and a non-positive total', () => {
    expect(() => splitEqual(100n, [])).toThrow(RangeError);
    expect(() => splitEqual(100n, ['a', 'a'])).toThrow(RangeError);
    expect(() => splitEqual(0n, ['a'])).toThrow(RangeError);
    expect(() => splitEqual(-1n, ['a'])).toThrow(RangeError);
  });
});

describe('splitByBasisPoints', () => {
  it('gives 60,000.00 and 40,000.00 for 100,000.00 ARS at 60% / 40% (AC-08)', () => {
    const result = splitByBasisPoints(10_000_000n, [
      { memberId: 'a', basisPoints: 6_000 },
      { memberId: 'b', basisPoints: 4_000 },
    ]);
    expect(result.get('a')).toBe(6_000_000n);
    expect(result.get('b')).toBe(4_000_000n);
  });

  it('gives the leftover units one each in list order', () => {
    const result = splitByBasisPoints(100n, [
      { memberId: 'a', basisPoints: 3_333 },
      { memberId: 'b', basisPoints: 3_333 },
      { memberId: 'c', basisPoints: 3_334 },
    ]);
    // Floors are 33, 33, 33: the one leftover unit goes to the first member.
    expect(result.get('a')).toBe(34n);
    expect(result.get('b')).toBe(33n);
    expect(result.get('c')).toBe(33n);
  });

  it('allows a zero-basis-point share', () => {
    const result = splitByBasisPoints(500n, [
      { memberId: 'a', basisPoints: 10_000 },
      { memberId: 'b', basisPoints: 0 },
    ]);
    expect(result.get('b')).toBe(0n);
    expect(sum(result)).toBe(500n);
  });

  it('rejects a total of 9,999 basis points and carries the total (AC-09)', () => {
    const error = catchError(() =>
      splitByBasisPoints(1_000n, [
        { memberId: 'a', basisPoints: 5_000 },
        { memberId: 'b', basisPoints: 4_999 },
      ]),
    );
    expect(error.code).toBe('GROUP_SPLIT_PERCENTAGE_INVALID');
    expect(error.details).toEqual({ total: '9999' });
  });

  it('rejects duplicated members, an empty list and out-of-range basis points', () => {
    expect(() =>
      splitByBasisPoints(100n, [
        { memberId: 'a', basisPoints: 5_000 },
        { memberId: 'a', basisPoints: 5_000 },
      ]),
    ).toThrow(RangeError);
    expect(() => splitByBasisPoints(100n, [])).toThrow(RangeError);
    expect(() => splitByBasisPoints(100n, [{ memberId: 'a', basisPoints: 10_001 }])).toThrow(
      RangeError,
    );
    expect(() => splitByBasisPoints(100n, [{ memberId: 'a', basisPoints: -1 }])).toThrow(
      RangeError,
    );
  });
});

describe('validateExactSplit', () => {
  it('returns an exact split that adds up as given (AC-10)', () => {
    const result = validateExactSplit(1_000n, [
      { memberId: 'a', amount: 700n },
      { memberId: 'b', amount: 300n },
    ]);
    expect(result.get('a')).toBe(700n);
    expect(result.get('b')).toBe(300n);
  });

  it('rejects a split that falls short with the signed difference (AC-11)', () => {
    const error = catchError(() =>
      validateExactSplit(1_000n, [
        { memberId: 'a', amount: 600n },
        { memberId: 'b', amount: 300n },
      ]),
    );
    expect(error.code).toBe('GROUP_SPLIT_AMOUNT_MISMATCH');
    expect(error.details).toEqual({ difference: '100' });
  });

  it('reports a negative difference when the shares exceed the amount (AC-11)', () => {
    const error = catchError(() =>
      validateExactSplit(1_000n, [
        { memberId: 'a', amount: 800n },
        { memberId: 'b', amount: 500n },
      ]),
    );
    expect(error.details).toEqual({ difference: '-300' });
  });

  it('allows zero-amount shares but rejects negatives, duplicates and an empty list', () => {
    const withZero = validateExactSplit(10n, [
      { memberId: 'a', amount: 10n },
      { memberId: 'b', amount: 0n },
    ]);
    expect(withZero.get('b')).toBe(0n);
    expect(() =>
      validateExactSplit(10n, [
        { memberId: 'a', amount: -1n },
        { memberId: 'b', amount: 11n },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      validateExactSplit(10n, [
        { memberId: 'a', amount: 5n },
        { memberId: 'a', amount: 5n },
      ]),
    ).toThrow(RangeError);
    expect(() => validateExactSplit(10n, [])).toThrow(RangeError);
  });
});

describe('property: shares add up to the total (NFR-02)', () => {
  const RUNS = 10_000;

  it('equal mode: 10,000 seeded splits', () => {
    const next = createRng(1n);
    for (let run = 0; run < RUNS; run += 1) {
      const total = 1n + next(10n ** 12n);
      const count = Number(1n + next(50n));
      const result = splitEqual(total, ids(count));
      expect(sum(result)).toBe(total);
      expect(result.size).toBe(count);
      for (const share of result.values()) expect(share >= 0n).toBe(true);
    }
  });

  it('percentage mode: 10,000 seeded splits', () => {
    const next = createRng(2n);
    for (let run = 0; run < RUNS; run += 1) {
      const total = 1n + next(10n ** 12n);
      const count = Number(1n + next(50n));
      // Random cut points over 0..10,000 give integer basis points that add up to 10,000.
      const cuts = Array.from({ length: count - 1 }, () => next(10_001n)).sort(compare);
      const bounds = [0n, ...cuts, 10_000n];
      const shares: BasisPointShare[] = gaps(bounds).map((gap, i) => ({
        memberId: `m${i}`,
        basisPoints: Number(gap),
      }));
      const result = splitByBasisPoints(total, shares);
      expect(sum(result)).toBe(total);
      for (const share of result.values()) expect(share >= 0n).toBe(true);
    }
  });

  it('exact mode: 10,000 seeded splits', () => {
    const next = createRng(3n);
    for (let run = 0; run < RUNS; run += 1) {
      const total = 1n + next(10n ** 12n);
      const count = Number(1n + next(50n));
      const cuts = Array.from({ length: count - 1 }, () => next(total + 1n)).sort(compare);
      const bounds = [0n, ...cuts, total];
      const shares: ExactShare[] = gaps(bounds).map((gap, i) => ({
        memberId: `m${i}`,
        amount: gap,
      }));
      const result = validateExactSplit(total, shares);
      expect(sum(result)).toBe(total);
      for (const share of result.values()) expect(share >= 0n).toBe(true);
    }
  });
});
