import type { AccountCurrency } from '@pesly/shared';
import { balancesByCurrency, balancesOf } from '../../groups';
import type { GroupBalanceSource } from '../application/ports/group-balance-reader';

export type PerCurrency = Record<AccountCurrency, bigint>;

export interface GroupTotals {
  /** Sum of the positive group balances, per currency. */
  owedToYou: PerCurrency;
  /** Sum of the negative group balances as a positive amount, per currency. */
  youOwe: PerCurrency;
}

const CURRENCIES: readonly AccountCurrency[] = ['ARS', 'USD'];

/** Balances are never netted across groups; a zero balance adds nothing (spec D10). */
export function groupTotalsOf(entries: readonly GroupBalanceSource[]): GroupTotals {
  const owedToYou: PerCurrency = { ARS: 0n, USD: 0n };
  const youOwe: PerCurrency = { ARS: 0n, USD: 0n };
  for (const entry of entries) {
    const own = balancesOf(balancesByCurrency(entry.sources), entry.memberId);
    for (const currency of CURRENCIES) {
      const balance = own[currency];
      if (balance > 0n) owedToYou[currency] += balance;
      else if (balance < 0n) youOwe[currency] -= balance;
    }
  }
  return { owedToYou, youOwe };
}

/** Owed to you minus you owe: the group part of the net worth. */
export function netOf(totals: GroupTotals): PerCurrency {
  return {
    ARS: totals.owedToYou.ARS - totals.youOwe.ARS,
    USD: totals.owedToYou.USD - totals.youOwe.USD,
  };
}
