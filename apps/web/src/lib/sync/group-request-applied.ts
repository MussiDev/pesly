import type { GroupExpenseResponse, SettlementResponse } from '@pesly/shared';
import type {
  ExpenseEditRequest,
  GroupRecordKind,
  SettlementEditRequest,
} from '@/lib/local-store/group-queue';

const sameInstant = (a: string, b: string): boolean =>
  new Date(a).getTime() === new Date(b).getTime();

/** Equal sets of keys, whatever their order; a repeated key never matches. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && new Set(a).size === a.length && b.every((key) => a.includes(key));
}

function splitApplied(split: ExpenseEditRequest['split'], current: GroupExpenseResponse): boolean {
  if (split.mode !== current.splitMode) return false;
  const shareIds = current.shares.map((share) => share.memberId);
  if (split.mode === 'equal') return sameKeys(split.memberIds, shareIds);
  if (split.mode === 'exact') {
    // Zero shares are allowed in the request: they may or may not come back as rows.
    const wanted = split.shares.filter((share) => BigInt(share.amount) > 0n);
    const stored = current.shares.filter((share) => BigInt(share.amount) > 0n);
    return (
      sameKeys(
        wanted.map((share) => share.memberId),
        stored.map((share) => share.memberId),
      ) &&
      wanted.every(
        (share) => stored.find((s) => s.memberId === share.memberId)?.amount === share.amount,
      )
    );
  }
  // The response carries amounts, not basis points: it cannot prove a percentage split was applied.
  return false;
}

/**
 * Whether the server copy of a record already holds what a queued edit would produce, strictly: the
 * edit was applied by an earlier attempt whose answer never arrived. Any field that differs, a
 * percentage split (the response does not expose its basis points) or a record of another kind
 * answers `false`, and the conflict is real.
 */
export function isRequestApplied(
  kind: GroupRecordKind,
  request: ExpenseEditRequest | SettlementEditRequest,
  current: GroupExpenseResponse | SettlementResponse,
): boolean {
  if (kind === 'settlement') {
    if (!('legs' in current)) return false;
    const edit: SettlementEditRequest = request;
    return (
      (edit.amount === undefined || edit.amount === current.amount) &&
      (edit.occurredAt === undefined || sameInstant(edit.occurredAt, current.occurredAt))
    );
  }
  if (!('shares' in current)) return false;
  const edit = request as ExpenseEditRequest;
  return (
    edit.amount === current.amount &&
    sameInstant(edit.occurredAt, current.occurredAt) &&
    edit.categoryId === current.categoryId &&
    edit.description === current.description &&
    splitApplied(edit.split, current)
  );
}
