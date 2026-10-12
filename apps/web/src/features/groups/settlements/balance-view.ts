import type { AccountCurrency, BalancesResponse, GroupDetailResponse } from '@pesly/shared';

export type BalanceStatus = 'owes' | 'owed' | 'even';

export interface MemberBalanceRow {
  memberId: string;
  /** Null for a member without a name; the screen shows the `groups.detail.unnamed` copy. */
  name: string | null;
  isSelf: boolean;
  /** Signed minor units: negative owes, positive is owed. */
  balance: bigint;
  status: BalanceStatus;
}

export interface PaymentRow {
  fromMemberId: string;
  toMemberId: string;
  fromName: string | null;
  toName: string | null;
  amount: bigint;
}

export interface CurrencyBalanceView {
  currency: AccountCurrency;
  /** Every balance is 0: nothing to pay. */
  settled: boolean;
  rows: MemberBalanceRow[];
  payments: PaymentRow[];
}

const CURRENCIES: readonly AccountCurrency[] = ['ARS', 'USD'];

function statusOf(balance: bigint): BalanceStatus {
  if (balance < 0n) return 'owes';
  return balance > 0n ? 'owed' : 'even';
}

/** The balances of both currencies as view data: the caller's row first, names resolved. */
export function buildBalanceView(
  balances: BalancesResponse,
  group: Pick<GroupDetailResponse, 'members' | 'formerMembers'>,
  selfMemberId: string,
): CurrencyBalanceView[] {
  const names = new Map<string, string | null>();
  for (const member of group.formerMembers) names.set(member.id, member.displayName);
  for (const member of group.members) names.set(member.id, member.displayName);
  const nameOf = (memberId: string): string | null => names.get(memberId) ?? null;

  return CURRENCIES.map((currency) => {
    const block = balances[currency];
    const rows = block.members.map((entry): MemberBalanceRow => {
      const balance = BigInt(entry.balance);
      return {
        memberId: entry.memberId,
        name: nameOf(entry.memberId),
        isSelf: entry.memberId === selfMemberId,
        balance,
        status: statusOf(balance),
      };
    });
    // A stable partition: the caller first, everyone else in the order the API sent.
    const ordered = [...rows.filter((row) => row.isSelf), ...rows.filter((row) => !row.isSelf)];
    const settled = rows.every((row) => row.balance === 0n);
    const payments = settled
      ? []
      : block.payments.map((payment): PaymentRow => ({
          fromMemberId: payment.fromMemberId,
          toMemberId: payment.toMemberId,
          fromName: nameOf(payment.fromMemberId),
          toName: nameOf(payment.toMemberId),
          amount: BigInt(payment.amount),
        }));
    return { currency, settled, rows: ordered, payments };
  });
}
