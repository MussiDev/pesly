import {
  REPORT_MAX_MONTHS,
  addMonths,
  monthsInRange,
  type IncomeExpensesResponse,
  type ReportFlowQuery,
} from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import { convertRows, installmentMonthOf } from '../domain/flows';
import { foldMonthlyFlows, type MonthAmount, type MonthlyFlow } from '../domain/monthly-flows';
import type { FlowReader, FlowWindow } from './ports/flow-reader';
import type { ReportUseCase } from './ports/report-use-cases';
import { prepareReport, type PrepareReportDependencies } from './prepare-report';

const SPEC = { maxMonths: REPORT_MAX_MONTHS.incomeExpenses, defaultMonths: 12 } as const;

export interface IncomeExpensesResult {
  currency: 'ARS' | 'USD';
  from: string;
  to: string;
  months: readonly MonthlyFlow[];
  unconvertedShareCount: number;
  unconvertedInstallmentCount: number;
}

export interface GetIncomeExpensesDependencies extends PrepareReportDependencies {
  flows: FlowReader;
  /** Writes the bigint result as the response; lives in infrastructure, so it is injected. */
  present: (result: IncomeExpensesResult) => IncomeExpensesResponse;
}

export class GetIncomeExpenses implements ReportUseCase<ReportFlowQuery, IncomeExpensesResponse> {
  constructor(private readonly deps: GetIncomeExpensesDependencies) {}

  async execute(scope: AccessScope, query: ReportFlowQuery): Promise<IncomeExpensesResponse> {
    const context = await prepareReport(this.deps, scope, query, SPEC);
    const { range, preferences, bounds } = context;
    if (range.months < 1 || range.months > SPEC.maxMonths) {
      throw new RangeError('The range does not fit the income and expenses report');
    }
    const display = preferences.displayCurrency;
    const window: FlowWindow = {
      from: bounds.from,
      before: bounds.before,
      timeZone: preferences.timeZone,
      ...(context.accountId === undefined ? {} : { accountId: context.accountId }),
      ...(context.tag === undefined ? {} : { tag: context.tag }),
    };

    // The due date can fall a month or two after the statement's period.
    const firstMonth = range.from.slice(0, 7);
    const lastMonth = range.to.slice(0, 7);
    // A card purchase counts in the month its statement is due, with or without an account or tag
    // filter (FEAT-010): unlike a share or an installment, it is a movement and can be filtered.
    const [personalRows, cardPurchaseRows] = await Promise.all([
      this.deps.flows.personalRows(scope, window),
      this.deps.flows.cardPurchaseRows(scope, addMonths(firstMonth, -2), addMonths(lastMonth, 2), {
        timeZone: window.timeZone,
        ...(context.accountId === undefined ? {} : { accountId: context.accountId }),
        ...(context.tag === undefined ? {} : { tag: context.tag }),
      }),
    ]);
    const personal = convertRows(personalRows, display, 'throw');
    const incomes: MonthAmount[] = [];
    const expenses: MonthAmount[] = [];
    for (const { row, amount } of personal.items) {
      (row.type === 'income' ? incomes : expenses).push({ month: row.month, amount });
    }
    for (const { row, amount } of convertRows(cardPurchaseRows, display, 'throw').items) {
      const month = installmentMonthOf(row, range.from, range.to);
      if (month !== null) expenses.push({ month, amount });
    }

    let unconvertedShareCount = 0;
    let unconvertedInstallmentCount = 0;
    // A filter narrows the report to movements: shares and installments have no account or tag.
    if (context.accountId === undefined && context.tag === undefined) {
      const shares = convertRows(await this.deps.flows.shareRows(scope, window), display, 'count');
      for (const { row, amount } of shares.items) expenses.push({ month: row.month, amount });
      unconvertedShareCount = shares.unconvertedCount;

      const rows = await this.deps.flows.installmentRows(
        scope,
        addMonths(firstMonth, -2),
        addMonths(lastMonth, 2),
      );
      const dueInRange = rows.flatMap((row) => {
        const month = installmentMonthOf(row, range.from, range.to);
        return month === null ? [] : [{ row, month }];
      });
      const converted = convertRows(
        dueInRange.map(({ row }) => row),
        display,
        'count',
      );
      const monthByRow = new Map(dueInRange.map(({ row, month }) => [row, month]));
      for (const { row, amount } of converted.items) {
        const month = monthByRow.get(row);
        if (month !== undefined) expenses.push({ month, amount });
      }
      unconvertedInstallmentCount = converted.unconvertedCount;
    }

    return this.deps.present({
      currency: display,
      from: range.from,
      to: range.to,
      months: foldMonthlyFlows(monthsInRange(range.from, range.to), incomes, expenses),
      unconvertedShareCount,
      unconvertedInstallmentCount,
    });
  }
}
