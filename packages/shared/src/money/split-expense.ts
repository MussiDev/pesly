import { AppError } from '../errors';

/** 100% in basis points: percentages are integers so "adds up to 100%" is an exact check. */
export const BASIS_POINTS_TOTAL = 10_000;

export interface BasisPointShare {
  memberId: string;
  basisPoints: number;
}

export interface ExactShare {
  memberId: string;
  amount: bigint;
}

/** A percentage split whose basis points do not add up to 10,000; `details.total` is the sum. */
export class SplitPercentageInvalidError extends AppError {
  constructor(total: number) {
    super('GROUP_SPLIT_PERCENTAGE_INVALID', undefined, undefined, { total: String(total) });
  }
}

/** An exact split that does not add up; `details.difference` is amount minus sum, signed. */
export class SplitAmountMismatchError extends AppError {
  constructor(difference: bigint) {
    super('GROUP_SPLIT_AMOUNT_MISMATCH', undefined, undefined, {
      difference: difference.toString(),
    });
  }
}

function assertUniqueMembers(memberIds: readonly string[]): void {
  if (memberIds.length === 0) throw new RangeError('A split needs at least one member');
  if (new Set(memberIds).size !== memberIds.length) {
    throw new RangeError('A split cannot repeat a member');
  }
}

function assertPositiveTotal(total: bigint): void {
  if (total <= 0n) throw new RangeError('The total to split must be positive');
}

function assertSumsTo(shares: Map<string, bigint>, total: bigint): void {
  let sum = 0n;
  for (const share of shares.values()) sum += share;
  if (sum !== total) throw new Error('Allocation does not add up to the total');
}

/**
 * Splits `total` minor units equally: each member gets `total / n` rounded down and the
 * `total mod n` leftover units go one each to the first members of the list. The caller orders the
 * list (payer first, then by joining order), so the leftover is deterministic (spec D3).
 */
export function splitEqual(
  total: bigint,
  orderedMemberIds: readonly string[],
): Map<string, bigint> {
  assertPositiveTotal(total);
  assertUniqueMembers(orderedMemberIds);
  const count = BigInt(orderedMemberIds.length);
  const base = total / count;
  const leftover = total % count;
  const shares = new Map<string, bigint>();
  orderedMemberIds.forEach((memberId, index) => {
    shares.set(memberId, BigInt(index) < leftover ? base + 1n : base);
  });
  assertSumsTo(shares, total);
  return shares;
}

/**
 * Splits `total` by basis points: each member gets `total * bp / 10,000` rounded down and the
 * leftover units go one each to the first members of the list. The basis points must add up to
 * exactly 10,000 or the split is rejected with the total they do add up to.
 */
export function splitByBasisPoints(
  total: bigint,
  orderedShares: readonly BasisPointShare[],
): Map<string, bigint> {
  assertPositiveTotal(total);
  assertUniqueMembers(orderedShares.map((share) => share.memberId));
  let basisPointsTotal = 0;
  for (const { basisPoints } of orderedShares) {
    if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > BASIS_POINTS_TOTAL) {
      throw new RangeError('Basis points must be an integer from 0 to 10,000');
    }
    basisPointsTotal += basisPoints;
  }
  if (basisPointsTotal !== BASIS_POINTS_TOTAL) {
    throw new SplitPercentageInvalidError(basisPointsTotal);
  }
  const whole = BigInt(BASIS_POINTS_TOTAL);
  const floors = orderedShares.map(({ memberId, basisPoints }) => ({
    memberId,
    floor: (total * BigInt(basisPoints)) / whole,
  }));
  let leftover = total - floors.reduce((acc, { floor }) => acc + floor, 0n);
  const shares = new Map<string, bigint>();
  for (const { memberId, floor } of floors) {
    const extra = leftover > 0n ? 1n : 0n;
    leftover -= extra;
    shares.set(memberId, floor + extra);
  }
  assertSumsTo(shares, total);
  return shares;
}

/** Exact amounts are taken as given; they must add up to `total` or the signed difference is reported. */
export function validateExactSplit(
  total: bigint,
  shares: readonly ExactShare[],
): Map<string, bigint> {
  assertPositiveTotal(total);
  assertUniqueMembers(shares.map((share) => share.memberId));
  let sum = 0n;
  const result = new Map<string, bigint>();
  for (const { memberId, amount } of shares) {
    if (amount < 0n) throw new RangeError('A share cannot be negative');
    sum += amount;
    result.set(memberId, amount);
  }
  if (sum !== total) throw new SplitAmountMismatchError(total - sum);
  return result;
}
