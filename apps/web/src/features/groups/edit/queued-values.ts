import {
  splitByBasisPoints,
  splitEqual,
  type GroupExpenseResponse,
  type SettlementResponse,
} from '@pesly/shared';
import type { ExpenseEditRequest, QueuedGroupChange } from '@/lib/local-store/group-queue';

type Shares = GroupExpenseResponse['shares'];

function payerFirst(ids: readonly string[], payerMemberId: string): string[] {
  return ids.includes(payerMemberId)
    ? [payerMemberId, ...ids.filter((id) => id !== payerMemberId)]
    : [...ids];
}

function sharesOf(
  split: ExpenseEditRequest['split'],
  amount: bigint,
  payerMemberId: string,
): Shares {
  if (split.mode === 'exact') {
    return split.shares.map((share) => ({ memberId: share.memberId, amount: share.amount }));
  }
  const order = payerFirst(
    split.mode === 'equal' ? split.memberIds : split.shares.map((share) => share.memberId),
    payerMemberId,
  );
  const amounts =
    split.mode === 'equal'
      ? splitEqual(amount, order)
      : splitByBasisPoints(
          amount,
          order.map((memberId) => ({
            memberId,
            basisPoints:
              split.shares.find((share) => share.memberId === memberId)?.basisPoints ?? 0,
          })),
        );
  return order.map((memberId) => ({ memberId, amount: (amounts.get(memberId) ?? 0n).toString() }));
}

/**
 * The record as a row should show it while its update waits: the queued amount, date, category,
 * description and shares applied on top of the loaded copy. Display only; the record passed in is
 * never changed, and anything but a pending update of the same kind leaves it as it is.
 */
export function applyQueuedValues<T extends GroupExpenseResponse | SettlementResponse>(
  record: T,
  change: QueuedGroupChange | undefined,
): T {
  if (change === undefined || change.operation !== 'update' || change.request === undefined) {
    return record;
  }
  if (change.kind === 'settlement' && 'fromMemberId' in record) {
    const { request } = change;
    return {
      ...record,
      ...(request.amount === undefined ? {} : { amount: request.amount }),
      ...(request.occurredAt === undefined ? {} : { occurredAt: request.occurredAt }),
    };
  }
  if (change.kind === 'expense' && 'splitMode' in record) {
    const { request } = change;
    let shares: Shares = record.shares;
    try {
      shares = sharesOf(request.split, BigInt(request.amount), record.payerMemberId);
    } catch {
      // A request the queue accepted but that does not split cleanly keeps the loaded shares.
    }
    return {
      ...record,
      amount: request.amount,
      occurredAt: request.occurredAt,
      categoryId: request.categoryId,
      description: request.description,
      splitMode: request.split.mode,
      shares,
    };
  }
  return record;
}
