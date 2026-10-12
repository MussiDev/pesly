import {
  localDayBounds,
  monthsInRange,
  netWorthPointDates,
  REPORT_MAX_MONTHS,
  type NetWorthQuery,
  type NetWorthResponse,
} from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import { installmentDebt } from '../domain/installment-debt';
import { assemblePoints, type AssembledPoint } from '../domain/net-worth';
import type { NetWorthRateReader } from './ports/net-worth-rate-reader';
import type { NetWorthSources, NetWorthWindow } from './ports/net-worth-sources';
import type { ReportUseCase } from './ports/report-use-cases';
import { prepareReport, type PrepareReportDependencies } from './prepare-report';

export interface GetNetWorthDependencies extends PrepareReportDependencies {
  sources: NetWorthSources;
  rates: NetWorthRateReader;
  present: (result: NetWorthResult) => NetWorthResponse;
}

export interface NetWorthResult {
  currency: 'ARS' | 'USD';
  from: string;
  to: string;
  points: AssembledPoint[];
}

const DEFAULT_MONTHS = 12;

export class GetNetWorth implements ReportUseCase<NetWorthQuery, NetWorthResponse> {
  constructor(private readonly deps: GetNetWorthDependencies) {}

  async execute(scope: AccessScope, query: NetWorthQuery): Promise<NetWorthResponse> {
    const context = await prepareReport(this.deps, scope, query, {
      maxMonths: REPORT_MAX_MONTHS.netWorth,
      defaultMonths: DEFAULT_MONTHS,
    });
    const { timeZone, displayCurrency, defaultRateType } = context.preferences;

    const months = monthsInRange(context.range.from, context.range.to);
    const dates = netWorthPointDates(months, context.today);
    const points = months.map((month, index) => {
      const date = dates[index] ?? context.range.to;
      return { month, date, end: localDayBounds(date, date, timeZone).before };
    });
    const firstMonth = months[0] ?? context.range.from.slice(0, 7);
    const lastDate = dates[dates.length - 1] ?? context.range.to;
    const window: NetWorthWindow = {
      start: localDayBounds(`${firstMonth}-01`, `${firstMonth}-01`, timeZone).from,
      end: localDayBounds(lastDate, lastDate, timeZone).before,
      timeZone,
      points,
    };

    const [accounts, groups, investments, debtRows, rates] = await Promise.all([
      this.deps.sources.accountFlows(scope, window),
      this.deps.sources.groupFlows(scope, window),
      this.deps.sources.investmentValues(scope, points),
      this.deps.sources.installmentDebtRows(scope, window),
      this.deps.rates.sellRates(defaultRateType, dates, context.today),
    ]);

    const assembled = assemblePoints({
      points,
      accounts,
      groups,
      investments,
      debt: installmentDebt(debtRows, points),
      rates,
      displayCurrency,
    });
    return this.deps.present({
      currency: displayCurrency,
      from: context.range.from,
      to: context.range.to,
      points: assembled,
    });
  }
}
