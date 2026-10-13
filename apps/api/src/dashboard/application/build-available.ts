import type { GetAvailableTotals } from '../../accounts';
import type { AccessScope } from '../../shared/access';
import { netWorthPartsNow } from '../domain/net-worth-now';
import type { DashboardContext } from './dashboard-context';

const ZERO = { ARS: 0n, USD: 0n };

/** The one method of `GetAvailableTotals` the dashboard uses. */
export interface BuildAvailableDependencies {
  accounts: Pick<GetAvailableTotals, 'execute'>;
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
  const [{ ARS, USD }, currentRate] = await Promise.all([deps.accounts.execute(scope), rate]);
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
