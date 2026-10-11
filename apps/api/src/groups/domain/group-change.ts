import type { AccountCurrency, ExpenseSnapshot, SettlementSnapshot } from '@pesly/shared';
import { GroupRecordEditForbidden, GroupRecordFormerMember } from './errors';
import { isAdmin, type Member } from './member';
import type { GroupSettlement, SettlementLeg } from './settlement';

/** What the permission rule and the snapshots need of a stored expense. */
export interface ExpenseChangeSource {
  amount: bigint;
  currency: AccountCurrency;
  occurredAt: Date;
  categoryId: string;
  description: string;
  splitMode: ExpenseSnapshot['splitMode'];
  payerMemberId: string;
  shares: readonly { memberId: string; amount: bigint }[];
}

/** The balance effect of an expense: the amount credited to the payer and the shares debited. */
export interface ExpenseEffect {
  payerMemberId: string;
  amount: bigint;
  shares: readonly { memberId: string; amount: bigint }[];
}

/** The balance effect of a plain or consolidated settlement: its legs between two members. */
export interface SettlementEffect {
  fromMemberId: string;
  toMemberId: string;
  legs: readonly SettlementLeg[];
}

/** A log action that records a change of an existing record. */
export type ChangeAction =
  'expense_updated' | 'expense_deleted' | 'settlement_updated' | 'settlement_deleted';

/** D1: the member who recorded it, or an admin. */
export function canChangeRecord(caller: Member, createdByMemberId: string): boolean {
  return caller.id === createdByMemberId || isAdmin(caller);
}

export function assertCanChangeRecord(caller: Member, createdByMemberId: string): void {
  if (!canChangeRecord(caller, createdByMemberId)) throw new GroupRecordEditForbidden();
}

/** A consolidated settlement carries a rate (its legs and rate describe two debts at once). */
export function isConsolidated(settlement: Pick<GroupSettlement, 'rateSource' | 'legs'>): boolean {
  return settlement.rateSource !== null || settlement.legs.length !== 1;
}

function addTo(map: Map<string, bigint>, memberId: string, value: bigint): void {
  map.set(memberId, (map.get(memberId) ?? 0n) + value);
}

function expenseDelta(
  map: Map<string, bigint>,
  effect: ExpenseEffect | null,
  sign: 1n | -1n,
): void {
  if (effect === null) return;
  addTo(map, effect.payerMemberId, effect.amount * sign);
  for (const share of effect.shares) addTo(map, share.memberId, -share.amount * sign);
}

/** Settlement deltas are kept per currency: opposite-signed legs must not cancel each other. */
function settlementDelta(
  map: Map<string, bigint>,
  effect: SettlementEffect | null,
  sign: 1n | -1n,
): void {
  if (effect === null) return;
  for (const leg of effect.legs) {
    addTo(map, `${leg.currency}:${effect.fromMemberId}`, leg.amount * sign);
    addTo(map, `${leg.currency}:${effect.toMemberId}`, -leg.amount * sign);
  }
}

function nonZero(map: Map<string, bigint>): string[] {
  return [...map.entries()].filter(([, value]) => value !== 0n).map(([key]) => key);
}

/**
 * The members whose balance an expense change alters (spec D5): `before` leaves the books and
 * `after` (null for a deletion) enters them. The currency is fixed, so one map is enough.
 */
export function expenseChangedMembers(
  before: ExpenseEffect,
  after: ExpenseEffect | null,
): string[] {
  const delta = new Map<string, bigint>();
  expenseDelta(delta, before, -1n);
  expenseDelta(delta, after, 1n);
  return nonZero(delta);
}

/** Same for a settlement; a date-only change alters no balance. */
export function settlementChangedMembers(
  before: SettlementEffect,
  after: SettlementEffect | null,
): string[] {
  const delta = new Map<string, bigint>();
  settlementDelta(delta, before, -1n);
  settlementDelta(delta, after, 1n);
  // A member is changed when any currency delta is non-zero; the key is `currency:memberId`.
  return [...new Set(nonZero(delta).map((key) => key.slice(key.indexOf(':') + 1)))];
}

/** D5: every member whose balance changes must still be active. */
export function assertChangedMembersActive(
  changed: readonly string[],
  activeMemberIds: ReadonlySet<string>,
): void {
  if (changed.some((memberId) => !activeMemberIds.has(memberId))) {
    throw new GroupRecordFormerMember();
  }
}

const byMemberId = (a: { memberId: string }, b: { memberId: string }): number =>
  a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0;

/** D7: amounts are integer strings; shares are sorted by member so before and after compare. */
export function expenseSnapshot(source: ExpenseChangeSource): ExpenseSnapshot {
  return {
    amount: source.amount.toString(),
    currency: source.currency,
    occurredAt: source.occurredAt.toISOString(),
    categoryId: source.categoryId,
    description: source.description,
    splitMode: source.splitMode,
    payerMemberId: source.payerMemberId,
    shares: [...source.shares]
      .sort(byMemberId)
      .map((share) => ({ memberId: share.memberId, amount: share.amount.toString() })),
  };
}

export function settlementSnapshot(
  source: Pick<
    GroupSettlement,
    'fromMemberId' | 'toMemberId' | 'currency' | 'amount' | 'occurredAt' | 'legs'
  >,
): SettlementSnapshot {
  return {
    fromMemberId: source.fromMemberId,
    toMemberId: source.toMemberId,
    currency: source.currency,
    amount: source.amount.toString(),
    occurredAt: source.occurredAt.toISOString(),
    legs: [...source.legs]
      .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0))
      .map((leg) => ({ currency: leg.currency, amount: leg.amount.toString() })),
  };
}
