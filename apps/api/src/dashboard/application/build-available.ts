import type { AccountList, ListAccountsOptions } from '../../accounts';
import type { AccessScope } from '../../shared/access';
import { netWorthPartsNow } from '../domain/net-worth-now';
import type { DashboardContext } from './dashboard-context';

const ZERO = { ARS: 0n, USD: 0n };

/** The one method of `ListAccounts` the dashboard uses. */
export interface BuildAvailableDependencies {
  accounts: {
    execute(
      scope: AccessScope,
      options: ListAccountsOptions,
    ): Promise<Pick<AccountList, 'availableTotals'>>;
  };
}

export interface AvailableParts {
  ars: bigint;
  usd: bigint;
  total: bigint | null;
  reason: 'no_rate' | null;
}

/**
 * The money available today: the accounts screen's own totals (all the active accounts marked
 * "include in available", whatever the page), converted with the rate the net worth already read.
 * Errors are not caught: a failed accounts read rejects the section and no amount is guessed.
 */
export async function buildAvailable(
  deps: BuildAvailableDependencies,
  scope: AccessScope,
  context: DashboardContext,
  rate: Promise<bigint | null>,
): Promise<AvailableParts> {
  const [list, currentRate] = await Promise.all([
    // The page is irrelevant: the totals cover every active account.
    deps.accounts.execute(scope, { archived: false, limit: 1, offset: 0 }),
    rate,
  ]);
  const { ARS, USD } = list.availableTotals;
  // The same conversion as the net worth, over a value that has only the available balances.
  const converted = netWorthPartsNow({
    context,
    accounts: { opening: ZERO, baseline: { ARS, USD }, byMonth: new Map() },
    debtRows: [],
    investments: { ARS: 0n, USD: 0n, holdingsWithoutPrice: 0 },
    groupNet: ZERO,
    rate: currentRate,
  });
  return { ars: ARS, usd: USD, total: converted.total, reason: converted.reason };
}
