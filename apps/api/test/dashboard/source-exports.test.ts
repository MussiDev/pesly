import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import * as budgets from '../../src/budgets';
import * as creditCards from '../../src/credit-cards';
import * as investments from '../../src/investments';
import * as recurring from '../../src/recurring';
import * as reports from '../../src/reports';
import type {
  CardPayments,
  CardPurchases,
  InstallmentRepository,
  InstallmentRow,
  StatementView,
} from '../../src/credit-cards';
import type { PortfolioView } from '../../src/investments';
import type {
  CurrencyAmounts,
  FlowReader,
  FlowWindow,
  NetWorthRateReader,
  NetWorthSources,
  NetWorthWindow,
  TopCategory,
} from '../../src/reports';
import type { UpcomingEntry } from '../../src/recurring';

// Type-only names are checked by the compiler through this tuple (a missing one fails typecheck).
export type DashboardFacingTypes = [
  FlowReader,
  FlowWindow,
  NetWorthSources,
  NetWorthWindow,
  NetWorthRateReader,
  CurrencyAmounts,
  TopCategory,
  UpcomingEntry,
  StatementView,
  InstallmentRow,
  InstallmentRepository,
  CardPurchases,
  CardPayments,
  PortfolioView,
];

const expected: Record<string, { module: Record<string, unknown>; names: string[] }> = {
  reports: {
    module: reports,
    names: [
      'DrizzleReportPreferences',
      'SystemClock',
      'DrizzleFlowReader',
      'DrizzleAccountFlowReader',
      'DrizzleInstallmentDebtReader',
      'DrizzleNetWorthRateReader',
      'accumulate',
      'assemblePoints',
      'installmentDebt',
      'convertRows',
      'installmentMonthOf',
      'matchShareCategory',
      'addToCategory',
      'orderCategoryTotals',
    ],
  },
  budgets: {
    module: budgets,
    names: ['DrizzleBudgetVersionReader', 'DrizzleSpendingReader', 'SystemClock'],
  },
  recurring: {
    module: recurring,
    names: [
      'ListUpcoming',
      'DrizzleRecurringPaymentRepository',
      'DrizzleOccurrenceRepository',
      'SystemClock',
    ],
  },
  'credit-cards': {
    module: creditCards,
    names: [
      'buildStatementViews',
      'owesStatement',
      'unpaidRemainder',
      'DrizzleCreditCardRepository',
      'DrizzleInstallmentRepository',
    ],
  },
  investments: {
    module: investments,
    names: [
      'ListPortfolios',
      'DrizzlePortfolioRepository',
      'DrizzleHoldingRepository',
      'DrizzleMarketPriceReader',
    ],
  },
};

// Runtime exports of each barrel before this block (the snapshot NFR-03 asks for).
const previous: Record<string, string[]> = {
  reports: ['createReportRoutes', 'prepareReport'],
  budgets: [
    'BudgetCategoryKindInvalid',
    'BudgetLimitReached',
    'BudgetMonthInFuture',
    'CreateBudget',
    'DeleteBudget',
    'EvaluateBudgetAlerts',
    'GetBudget',
    'GetBudgetSpending',
    'ListBudgetSpending',
    'ListBudgets',
    'UpdateBudget',
    'assertBudgetCategories',
    'computeBudgetSpending',
    'computeSpending',
    'convertAmount',
    'createBudgetAlertListener',
    'createBudgetRoutes',
    'crossedThresholds',
    'currentMonthStart',
    'effectiveNames',
    'mergeVersion',
    'monthBounds',
    'monthOf',
    'monthStartDate',
    'monthStartFor',
    'monthStartOf',
    'namesMatch',
    'normalizeThresholds',
    'percentUsed',
    'previousMonth',
    'spendingOf',
    'versionInForce',
  ],
  recurring: ['createRecurringRoutes', 'eraseUserRecurring'],
  'credit-cards': [
    'createCardAccountLinks',
    'createCreditCardRoutes',
    'createInstallmentCategoryUsage',
    'eraseUserCreditCards',
  ],
  investments: ['createInvestmentsRoutes'],
};

function assertExport(barrel: string, module: Record<string, unknown>, name: string): void {
  if (typeof module[name] !== 'function') {
    throw new Error(`Barrel "${barrel}" does not export "${name}"`);
  }
}

describe('source module barrels (spec 09b Block 1)', () => {
  for (const [barrel, { module, names }] of Object.entries(expected)) {
    it(`${barrel} exports the dashboard-facing names as functions or classes`, () => {
      for (const name of names) assertExport(barrel, module, name);
    });
  }

  it('loads the five barrels together in one fresh process without a circular import error', () => {
    const script = `
      const mods = await Promise.all([
        import('./src/reports/index.ts'), import('./src/budgets/index.ts'),
        import('./src/recurring/index.ts'), import('./src/credit-cards/index.ts'),
        import('./src/investments/index.ts'),
      ]);
      console.log('LOADED ' + mods.length);
    `;
    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      {
        cwd: new URL('../..', import.meta.url),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    expect(out).toContain('LOADED 5');
  }, 60_000);

  it('keeps every previous export of each barrel', () => {
    for (const [barrel, names] of Object.entries(previous)) {
      const module = expected[barrel]?.module ?? {};
      for (const name of names) {
        expect(name in module, `${barrel} lost ${name}`).toBe(true);
      }
    }
  });

  it('reports a missing export naming the barrel and the symbol', () => {
    expect(() => {
      assertExport('reports', reports, 'doesNotExist');
    }).toThrow('Barrel "reports" does not export "doesNotExist"');
  });
});
