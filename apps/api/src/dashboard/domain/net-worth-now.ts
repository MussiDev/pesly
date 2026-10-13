import { localDayBounds } from '@pesly/shared';
import {
  accumulate,
  assemblePoints,
  installmentDebt,
  type AccountFlows,
  type CurrencyAmounts,
  type InstallmentDebtRow,
  type NetWorthWindow,
} from '../../reports';
import type { DashboardContext } from '../application/dashboard-context';
import type { InvestmentValue } from '../application/ports/investment-valuation';

const ZERO: CurrencyAmounts = { ARS: 0n, USD: 0n };

export interface NetWorthParts {
  ars: bigint;
  usd: bigint;
  total: bigint | null;
  reason: 'no_rate' | null;
  /** The stored sell rate the conversion used (scaled by 10,000); null when there was none. */
  rate: bigint | null;
  holdingsWithoutPrice: number;
  parts: {
    accounts: CurrencyAmounts;
    investments: CurrencyAmounts;
    groups: CurrencyAmounts;
    /** A positive amount that is subtracted. */
    installmentDebt: CurrencyAmounts;
  };
}

/** The one-point window of today: from the first local instant of the month to after today. */
export function netWorthWindow(context: DashboardContext): NetWorthWindow {
  const { timeZone } = context.preferences;
  const end = localDayBounds(context.today, context.today, timeZone).before;
  return {
    start: localDayBounds(context.monthStart, context.monthStart, timeZone).from,
    end,
    timeZone,
    points: [{ date: context.today, month: context.month, end }],
  };
}

export interface NetWorthPartsInput {
  context: DashboardContext;
  accounts: AccountFlows;
  debtRows: readonly InstallmentDebtRow[];
  investments: InvestmentValue;
  /** The group part: owed to you minus you owe, per currency. */
  groupNet: CurrencyAmounts;
  /** The stored sell rate (scaled by 10,000), or null when there is none. */
  rate: bigint | null;
}

/** The 09a accumulation and assembly over the single point of today. */
export function netWorthPartsNow(input: NetWorthPartsInput): NetWorthParts {
  const { context } = input;
  const point = { date: context.today, month: context.month };
  const accountPart =
    accumulate(input.accounts.opening, input.accounts.baseline, input.accounts.byMonth, [
      context.month,
    ]).get(context.month) ?? ZERO;
  const debt = installmentDebt(input.debtRows, [point]).get(context.today) ?? ZERO;
  const investments: CurrencyAmounts = { ARS: input.investments.ARS, USD: input.investments.USD };

  const [assembled] = assemblePoints({
    points: [point],
    accounts: { opening: ZERO, baseline: accountPart, byMonth: new Map() },
    groups: { baseline: input.groupNet, byMonth: new Map() },
    investments: {
      values: new Map([[context.today, investments]]),
      incompleteDates: new Set(),
    },
    debt: new Map([[context.today, debt]]),
    rates: new Map([[context.today, input.rate]]),
    displayCurrency: context.preferences.displayCurrency,
  });
  if (assembled === undefined) throw new Error('Net worth assembly returned no point');

  return {
    ars: assembled.ars,
    usd: assembled.usd,
    total: assembled.total,
    reason: assembled.reason,
    rate: input.rate,
    holdingsWithoutPrice: input.investments.holdingsWithoutPrice,
    parts: {
      accounts: accountPart,
      investments,
      groups: { ...input.groupNet },
      installmentDebt: debt,
    },
  };
}
