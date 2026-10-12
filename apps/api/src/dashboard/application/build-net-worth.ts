import type { NetWorthRateReader, NetWorthSources } from '../../reports';
import type { AccessScope } from '../../shared/access';
import { netWorthPartsNow, netWorthWindow, type NetWorthParts } from '../domain/net-worth-now';
import type { PerCurrency } from '../domain/group-totals';
import type { DashboardContext } from './dashboard-context';
import type { InvestmentValuation } from './ports/investment-valuation';

export interface BuildNetWorthDependencies {
  sources: Pick<NetWorthSources, 'accountFlows' | 'installmentDebtRows'>;
  rates: NetWorthRateReader;
  investments: InvestmentValuation;
}

/**
 * The net worth today. The four reads run in parallel; the rate is the stored current one. Errors
 * are not caught: a failed source rejects the section and no part is guessed.
 */
export async function buildNetWorth(
  deps: BuildNetWorthDependencies,
  scope: AccessScope,
  context: DashboardContext,
  groupNet: PerCurrency,
): Promise<NetWorthParts> {
  const window = netWorthWindow(context);
  const [accounts, debtRows, investments, rates] = await Promise.all([
    deps.sources.accountFlows(scope, window),
    deps.sources.installmentDebtRows(scope, window),
    deps.investments.valueNow(scope),
    deps.rates.sellRates(context.preferences.defaultRateType, [context.today], context.today),
  ]);
  return netWorthPartsNow({
    context,
    accounts,
    debtRows,
    investments,
    groupNet,
    rate: rates.get(context.today) ?? null,
  });
}
