import type { AccessScope } from '../../../shared/access';
import type { CurrencyAmounts, InstallmentDebtRow } from '../../domain/installment-debt';

export type { CurrencyAmounts, InstallmentDebtRow };

export interface NetWorthPoint {
  /** `YYYY-MM-DD`: the last day of the month, or today for the current month. */
  date: string;
  /** `YYYY-MM`. */
  month: string;
  /** The first instant after the point's local day. */
  end: Date;
}

export interface NetWorthWindow {
  /** The first instant of the first point's month: everything before it is the baseline. */
  start: Date;
  /** The first instant after the last point's local day. */
  end: Date;
  timeZone: string;
  points: readonly NetWorthPoint[];
}

/** Signed minor units per currency, bucketed by month (`YYYY-MM`) in the user's zone. */
export interface MonthlyFlows {
  /** Everything before the window start. */
  baseline: CurrencyAmounts;
  byMonth: ReadonlyMap<string, CurrencyAmounts>;
}

export interface AccountFlows extends MonthlyFlows {
  /** The opening balances of the non-archived accounts. */
  opening: CurrencyAmounts;
}

export type GroupFlows = MonthlyFlows;

export interface InvestmentValues {
  /** The summed latest snapshots per point date; a point with none is absent. */
  values: ReadonlyMap<string, CurrencyAmounts>;
  /** Point dates with a portfolio created before them that has no snapshot yet. */
  incompleteDates: ReadonlySet<string>;
}

/** The four sources of a net worth point; each read is one statement and fails as a whole. */
export interface NetWorthSources {
  accountFlows(scope: AccessScope, window: NetWorthWindow): Promise<AccountFlows>;
  groupFlows(scope: AccessScope, window: NetWorthWindow): Promise<GroupFlows>;
  investmentValues(scope: AccessScope, points: readonly NetWorthPoint[]): Promise<InvestmentValues>;
  installmentDebtRows(scope: AccessScope, window: NetWorthWindow): Promise<InstallmentDebtRow[]>;
}
