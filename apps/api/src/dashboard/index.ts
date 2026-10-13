import { DrizzleAccountRepository, GetAvailableTotals } from '../accounts';
import type { RouterFactory } from '../app';
import {
  DrizzleBudgetVersionReader,
  DrizzleSpendingReader,
  SystemClock as BudgetsSystemClock,
} from '../budgets';
import {
  DrizzleHoldingRepository,
  DrizzleMarketPriceReader,
  DrizzlePortfolioRepository,
  ListPortfolios,
} from '../investments';
import { createAccountMovements, createCardPayments, createCardPurchases } from '../movements';
import {
  DrizzleOccurrenceRepository,
  DrizzleRecurringPaymentRepository,
  ListUpcoming,
  SystemClock as RecurringSystemClock,
} from '../recurring';
import {
  DrizzleAccountFlowReader,
  DrizzleFlowReader,
  DrizzleInstallmentDebtReader,
  DrizzleNetWorthRateReader,
  DrizzleReportPreferences,
  SystemClock as ReportsSystemClock,
} from '../reports';
import { ContextTimeZones } from './application/context-time-zones';
import { GetDashboard } from './application/get-dashboard';
import type { DashboardUseCase } from './application/ports/dashboard-use-case';
import { DrizzleCardStatementSource } from './infrastructure/credit-cards/drizzle-card-statement-source';
import { DrizzleAccountCurrencyReader } from './infrastructure/db/drizzle-account-currency-reader';
import { DrizzleFirstStepsReader } from './infrastructure/db/drizzle-first-steps-reader';
import { DrizzleGroupBalanceReader } from './infrastructure/db/drizzle-group-balance-reader';
import {
  createDashboardRoutes as createDashboardRouter,
  type DashboardRoutesOptions as DashboardRouterOptions,
} from './infrastructure/http/dashboard-routes';
import { presentDashboard } from './infrastructure/http/present-dashboard';
import { PortfolioValuation } from './infrastructure/investments/portfolio-valuation';

export type { DashboardUseCase } from './application/ports/dashboard-use-case';

export type DashboardRoutesOptions = Omit<DashboardRouterOptions, 'useCase'> & {
  /** Replaces the default composition; tests use it to run the routes on a fake use case. */
  useCase?: DashboardUseCase;
};

/** The default composition: the Drizzle readers of the source modules behind `GetDashboard`. */
function composeUseCase({ db, clock }: Pick<DashboardRouterOptions, 'db' | 'clock'>): GetDashboard {
  const reportsClock = clock ?? new ReportsSystemClock();
  const budgetsClock = clock ?? new BudgetsSystemClock();
  const recurringClock = clock ?? new RecurringSystemClock();
  const accounts = new DrizzleAccountFlowReader(db);
  const debt = new DrizzleInstallmentDebtReader(db);
  const payments = new DrizzleRecurringPaymentRepository(db);
  const occurrences = new DrizzleOccurrenceRepository(db);

  return new GetDashboard({
    clock: reportsClock,
    preferences: new DrizzleReportPreferences(db),
    netWorth: {
      sources: {
        accountFlows: (scope, window) => accounts.accountFlows(scope, window),
        installmentDebtRows: (scope, window) => debt.installmentDebtRows(scope, window),
      },
      rates: new DrizzleNetWorthRateReader(db),
      investments: new PortfolioValuation(
        new ListPortfolios(
          new DrizzlePortfolioRepository(db),
          new DrizzleHoldingRepository(db),
          new DrizzleMarketPriceReader(db),
          reportsClock,
        ),
      ),
    },
    available: {
      accounts: new GetAvailableTotals({
        accounts: new DrizzleAccountRepository(db),
        movements: createAccountMovements(db),
      }),
    },
    flows: { flows: new DrizzleFlowReader(db) },
    budgets: {
      versions: new DrizzleBudgetVersionReader(db),
      spending: new DrizzleSpendingReader(db),
      clock: budgetsClock,
    },
    agenda: {
      // Built per request: its zone is the one the request already read.
      upcoming: (context) =>
        new ListUpcoming({
          payments,
          occurrences,
          timeZones: new ContextTimeZones(context.userId, context.preferences.timeZone),
          clock: recurringClock,
        }),
      currencies: new DrizzleAccountCurrencyReader(db),
      statements: new DrizzleCardStatementSource({
        db,
        purchases: createCardPurchases(db),
        cardPayments: createCardPayments(db),
      }),
    },
    groups: { groupBalances: new DrizzleGroupBalanceReader(db) },
    firstSteps: { firstSteps: new DrizzleFirstStepsReader(db) },
    present: presentDashboard,
  });
}

/** `/dashboard`: the route of Block 2 over the default composition unless `useCase` is given. */
export function createDashboardRoutes(options: DashboardRoutesOptions): RouterFactory {
  return createDashboardRouter({
    ...options,
    useCase: options.useCase ?? composeUseCase(options),
  });
}
