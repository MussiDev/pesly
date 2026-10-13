import type { AccountCurrency } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import { balanceOf, totalsOf } from '../domain/account';
import { sumsFor } from './account-balances';
import type { AccountMovements } from './ports/account-movements';
import type { AccountRepository } from './ports/account-repository';

export interface GetAvailableTotalsDependencies {
  accounts: AccountRepository;
  movements: AccountMovements;
}

/**
 * Only the "available" totals of the accounts screen: the same rule (`totalsOf` over the balances of
 * all active accounts) without the page, the count or the other totals, so it costs fewer statements.
 */
export class GetAvailableTotals {
  constructor(private readonly deps: GetAvailableTotalsDependencies) {}

  async execute(scope: AccessScope): Promise<Record<AccountCurrency, bigint>> {
    const active = await this.deps.accounts.listActive(scope);
    const sums = await sumsFor(
      this.deps.movements,
      active.map((account) => account.id),
    );
    return totalsOf(
      active.map((account) => ({
        type: account.type,
        currency: account.currency,
        includeInAvailable: account.includeInAvailable,
        balance: balanceOf(account.openingBalance, sums.get(account.id) ?? 0n),
      })),
    ).available;
  }
}
