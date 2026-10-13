import { addMonths, type ExpensesByCategoryResponse, type ReportFlowQuery } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import { addToCategory, orderCategoryTotals } from '../domain/category-totals';
import { convertRows, installmentMonthOf, matchShareCategory } from '../domain/flows';
import type { FlowReader } from './ports/flow-reader';
import { prepareReport, type PrepareReportDependencies } from './prepare-report';

export interface GetExpensesByCategoryDependencies extends PrepareReportDependencies {
  flows: FlowReader;
}

const MAX_MONTHS = 24;
const DEFAULT_MONTHS = 1;
/** A statement is due at most this many months after its period, and not before it. */
const PERIOD_MARGIN = 2;

export class GetExpensesByCategory {
  constructor(private readonly deps: GetExpensesByCategoryDependencies) {}

  async execute(scope: AccessScope, query: ReportFlowQuery): Promise<ExpensesByCategoryResponse> {
    const context = await prepareReport(this.deps, scope, query, {
      maxMonths: MAX_MONTHS,
      defaultMonths: DEFAULT_MONTHS,
    });
    const { flows } = this.deps;
    const display = context.preferences.displayCurrency;
    const filtered = context.accountId !== undefined || context.tag !== undefined;
    const window = {
      ...context.bounds,
      timeZone: context.preferences.timeZone,
      ...(context.accountId === undefined ? {} : { accountId: context.accountId }),
      ...(context.tag === undefined ? {} : { tag: context.tag }),
    };

    // A card purchase counts in the month its statement is due, with or without an account or tag
    // filter (FEAT-010): unlike a share or an installment, it is a movement and can be filtered.
    const [personalRows, cardPurchaseRows] = await Promise.all([
      flows.personalRows(scope, window),
      flows.cardPurchaseRows(
        scope,
        addMonths(context.range.from.slice(0, 7), -PERIOD_MARGIN),
        addMonths(context.range.to.slice(0, 7), PERIOD_MARGIN),
        {
          timeZone: window.timeZone,
          ...(context.accountId === undefined ? {} : { accountId: context.accountId }),
          ...(context.tag === undefined ? {} : { tag: context.tag }),
        },
      ),
    ]);
    const known = await flows.topCategories(scope);
    const [shareRows, installmentRows] = filtered
      ? [[], []]
      : await Promise.all([
          flows.shareRows(scope, window),
          flows.installmentRows(
            scope,
            addMonths(context.range.from.slice(0, 7), -PERIOD_MARGIN),
            addMonths(context.range.to.slice(0, 7), PERIOD_MARGIN),
          ),
        ]);
    const byId = new Map(known.map((category) => [category.id, category]));

    const totals = new Map<string | null, bigint>();
    const requireKnown = (id: string): void => {
      if (!byId.has(id)) throw new RangeError(`Top-level category ${id} is missing`);
    };

    const personal = convertRows(
      personalRows.filter((row) => row.type === 'expense'),
      display,
      'throw',
    );
    for (const { row, amount } of personal.items) {
      requireKnown(row.topCategoryId);
      addToCategory(totals, row.topCategoryId, amount);
    }

    const cardDue = cardPurchaseRows.filter(
      (row) => installmentMonthOf(row, context.range.from, context.range.to) !== null,
    );
    for (const { row, amount } of convertRows(cardDue, display, 'throw').items) {
      requireKnown(row.topCategoryId);
      addToCategory(totals, row.topCategoryId, amount);
    }

    const shares = convertRows(shareRows, display, 'count');
    for (const { row, amount } of shares.items) {
      const id = matchShareCategory(
        { name: row.categoryName, defaultKey: row.categoryDefaultKey },
        known,
      );
      addToCategory(totals, id, amount);
    }

    const due = installmentRows.filter(
      (row) => installmentMonthOf(row, context.range.from, context.range.to) !== null,
    );
    const installments = convertRows(due, display, 'count');
    for (const { row, amount } of installments.items) {
      requireKnown(row.topCategoryId);
      addToCategory(totals, row.topCategoryId, amount);
    }

    const ordered = orderCategoryTotals(totals);
    return {
      currency: display,
      from: context.range.from,
      to: context.range.to,
      total: ordered.reduce((sum, row) => sum + row.amount, 0n).toString(),
      categories: ordered.map((row) => {
        const category = row.categoryId === null ? undefined : byId.get(row.categoryId);
        return {
          categoryId: row.categoryId,
          name: category?.name ?? null,
          defaultKey: category?.defaultKey ?? null,
          amount: row.amount.toString(),
        };
      }),
      unconvertedShareCount: shares.unconvertedCount,
      unconvertedInstallmentCount: installments.unconvertedCount,
    };
  }
}
