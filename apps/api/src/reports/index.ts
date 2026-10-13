import type { RouterFactory } from '../app';
import { GetExpensesByCategory } from './application/get-expenses-by-category';
import { GetIncomeExpenses } from './application/get-income-expenses';
import { GetNetWorth } from './application/get-net-worth';
import type { NetWorthSources } from './application/ports/net-worth-sources';
import type { ReportUseCases } from './application/ports/report-use-cases';
import { SystemClock } from './infrastructure/clock/system-clock';
import { DrizzleAccountFlowReader } from './infrastructure/db/drizzle-account-flow-reader';
import { DrizzleFlowReader } from './infrastructure/db/drizzle-flow-reader';
import { DrizzleGroupFlowReader } from './infrastructure/db/drizzle-group-flow-reader';
import { DrizzleInstallmentDebtReader } from './infrastructure/db/drizzle-installment-debt-reader';
import { DrizzleInvestmentReader } from './infrastructure/db/drizzle-investment-reader';
import { DrizzleNetWorthRateReader } from './infrastructure/db/drizzle-net-worth-rate-reader';
import { DrizzleReportFilterReader } from './infrastructure/db/drizzle-report-filter-reader';
import { DrizzleReportPreferences } from './infrastructure/db/drizzle-report-preferences';
import { presentIncomeExpenses } from './infrastructure/http/present-income-expenses';
import { presentNetWorth } from './infrastructure/http/present-net-worth';
import {
  createReportRoutes as createReportRouter,
  type ReportRoutesOptions as ReportRouterOptions,
} from './infrastructure/http/report-routes';

export * from './application/ports/clock';
export * from './application/ports/report-preferences';
export * from './application/ports/report-filter-reader';
export * from './application/ports/report-use-cases';
export * from './application/prepare-report';

export type ReportRoutesOptions = Omit<ReportRouterOptions, 'useCases'> & {
  /** Replaces the default composition; tests use it to run the routes on fake use cases. */
  useCases?: ReportUseCases;
};

/** The default composition: the Drizzle readers behind the three use cases (read-only). */
function composeUseCases({ db, clock }: Pick<ReportRouterOptions, 'db' | 'clock'>): ReportUseCases {
  const common = {
    clock: clock ?? new SystemClock(),
    preferences: new DrizzleReportPreferences(db),
    filters: new DrizzleReportFilterReader(db),
  };
  const accounts = new DrizzleAccountFlowReader(db);
  const groups = new DrizzleGroupFlowReader(db);
  const investments = new DrizzleInvestmentReader(db);
  const debt = new DrizzleInstallmentDebtReader(db);
  const sources: NetWorthSources = {
    accountFlows: (scope, window) => accounts.accountFlows(scope, window),
    groupFlows: (scope, window) => groups.groupFlows(scope, window),
    investmentValues: (scope, points) => investments.investmentValues(scope, points),
    installmentDebtRows: (scope, window) => debt.installmentDebtRows(scope, window),
  };
  const flows = new DrizzleFlowReader(db);
  return {
    expensesByCategory: new GetExpensesByCategory({ ...common, flows }),
    incomeExpenses: new GetIncomeExpenses({ ...common, flows, present: presentIncomeExpenses }),
    netWorth: new GetNetWorth({
      ...common,
      sources,
      rates: new DrizzleNetWorthRateReader(db),
      present: presentNetWorth,
    }),
  };
}

/** `/reports`: the routes of Block 2 over the default composition unless `useCases` is given. */
export function createReportRoutes(options: ReportRoutesOptions): RouterFactory {
  return createReportRouter({
    ...options,
    useCases: options.useCases ?? composeUseCases(options),
  });
}

// Reused by the dashboard module (09b): readers, pure rules and the ports they implement.
export { SystemClock } from './infrastructure/clock/system-clock';
export { DrizzleAccountFlowReader } from './infrastructure/db/drizzle-account-flow-reader';
export { DrizzleFlowReader } from './infrastructure/db/drizzle-flow-reader';
export { DrizzleInstallmentDebtReader } from './infrastructure/db/drizzle-installment-debt-reader';
export { DrizzleNetWorthRateReader } from './infrastructure/db/drizzle-net-worth-rate-reader';
export { DrizzleReportPreferences } from './infrastructure/db/drizzle-report-preferences';
export { addToCategory, orderCategoryTotals } from './domain/category-totals';
export { convertRows, installmentMonthOf, matchShareCategory } from './domain/flows';
export type { TopCategory } from './domain/flows';
export { installmentDebt } from './domain/installment-debt';
export type { CurrencyAmounts } from './domain/installment-debt';
export { accumulate, assemblePoints } from './domain/net-worth';
export type {
  CardPurchaseFlowRow,
  CardPurchaseOptions,
  FlowReader,
  FlowWindow,
} from './application/ports/flow-reader';
export type { NetWorthRateReader } from './application/ports/net-worth-rate-reader';
export type {
  AccountFlows,
  InstallmentDebtRow,
  NetWorthSources,
  NetWorthWindow,
} from './application/ports/net-worth-sources';
