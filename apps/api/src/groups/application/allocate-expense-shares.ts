import { splitByBasisPoints, splitEqual, validateExactSplit, type GroupSplit } from '@pesly/shared';
import { orderSplitMembers } from '../domain/group-expense';
import type { Member } from '../domain/member';
import type { NewGroupExpenseShare } from './ports/group-expense-repository';

export function splitMemberIds(split: GroupSplit): string[] {
  return split.mode === 'equal' ? split.memberIds : split.shares.map((share) => share.memberId);
}

/**
 * The allocation step shared by creating and editing an expense (spec 05b D3, 05d D2): orders the
 * split members (payer first, then joining order) and allocates so the shares add up to `amount`.
 * Throws the typed split errors of 05b.
 */
export function allocateShares(
  amount: bigint,
  payerMemberId: string,
  split: GroupSplit,
  members: readonly Pick<Member, 'id' | 'joinedAt'>[],
): NewGroupExpenseShare[] {
  const shares = allocateOrdered(
    amount,
    split,
    orderSplitMembers(payerMemberId, splitMemberIds(split), members),
  );
  const total = shares.reduce((sum, share) => sum + share.amount, 0n);
  if (total !== amount) throw new Error('Allocation does not add up to the expense amount');
  return shares;
}

function allocateOrdered(
  amount: bigint,
  split: GroupSplit,
  order: string[],
): NewGroupExpenseShare[] {
  if (split.mode === 'equal') {
    const amounts = splitEqual(amount, order);
    return order.map((memberId) => ({
      memberId,
      amount: amounts.get(memberId) ?? 0n,
      basisPoints: null,
    }));
  }
  if (split.mode === 'percentage') {
    const basisPoints = new Map(split.shares.map((share) => [share.memberId, share.basisPoints]));
    const amounts = splitByBasisPoints(
      amount,
      order.map((memberId) => ({ memberId, basisPoints: basisPoints.get(memberId) ?? 0 })),
    );
    return order.map((memberId) => ({
      memberId,
      amount: amounts.get(memberId) ?? 0n,
      basisPoints: basisPoints.get(memberId) ?? 0,
    }));
  }
  const amounts = validateExactSplit(
    amount,
    split.shares.map((share) => ({ memberId: share.memberId, amount: BigInt(share.amount) })),
  );
  return order.map((memberId) => ({
    memberId,
    amount: amounts.get(memberId) ?? 0n,
    basisPoints: null,
  }));
}
