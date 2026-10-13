import { addMonths, localDayBounds } from '@pesly/shared';
import {
  convertRows,
  installmentMonthOf,
  matchShareCategory,
  type FlowReader,
  type FlowWindow,
} from '../../reports';
import type { AccessScope } from '../../shared/access';
import { foldMonthFlows, type FlowEntry } from '../domain/month-flows';
import { changePercent, toJsonInt } from '../domain/percent';
import { monthPeriods } from '../domain/period';
import type { DashboardContext } from './dashboard-context';

export interface MonthFlowsDependencies {
  flows: FlowReader;
}

export interface MonthFlowsCategory {
  categoryId: string | null;
  name: string | null;
  defaultKey: string | null;
  amount: bigint;
  sharePercent: number;
}

export interface MonthFlowsInsight extends MonthFlowsCategory {
  changePercent: number | null;
}

export interface MonthFlowsResult {
  month: {
    from: string;
    to: string;
    expenses: bigint;
    income: bigint;
    net: bigint;
    change: { expenses: number | null; income: number | null; net: number | null };
    unconvertedShareCount: number;
    unconvertedInstallmentCount: number;
  };
  categories: MonthFlowsCategory[];
  insight: MonthFlowsInsight | null;
}

/** A statement is due at most this many months after its period, and not before it. */
const PERIOD_MARGIN = 2;

function jsonChange(current: bigint, previous: bigint): number | null {
  const change = changePercent(current, previous);
  return change === null ? null : toJsonInt(change);
}

/**
 * The month to date, its categories and the insight (FR-05 to FR-07, FR-12). Six reads; the
 * month-to-date and the three complete months come from one wide read bucketed by month.
 */
export async function buildMonthFlows(
  deps: MonthFlowsDependencies,
  scope: AccessScope,
  context: DashboardContext,
): Promise<MonthFlowsResult> {
  const { flows } = deps;
  const { timeZone, displayCurrency } = context.preferences;
  const periods = monthPeriods(context.today);
  const historyFrom = `${periods.history[0] ?? periods.month}-01`;

  const main = localDayBounds(historyFrom, context.today, timeZone);
  const previous = localDayBounds(periods.previousFrom, periods.previousTo, timeZone);
  const mainWindow: FlowWindow = { ...main, timeZone };
  const previousWindow: FlowWindow = { ...previous, timeZone };

  const [personal, shares, previousPersonal, previousShares, installmentRows, cardRows, known] =
    await Promise.all([
      flows.personalRows(scope, mainWindow),
      flows.shareRows(scope, mainWindow),
      flows.personalRows(scope, previousWindow),
      flows.shareRows(scope, previousWindow),
      flows.installmentRows(
        scope,
        addMonths(historyFrom.slice(0, 7), -PERIOD_MARGIN),
        addMonths(periods.month, PERIOD_MARGIN),
      ),
      // A card purchase counts in the month its statement is due, like an installment (FEAT-010).
      flows.cardPurchaseRows(
        scope,
        addMonths(historyFrom.slice(0, 7), -PERIOD_MARGIN),
        addMonths(periods.month, PERIOD_MARGIN),
        { timeZone },
      ),
      flows.topCategories(scope),
    ]);
  const installments = [...installmentRows, ...cardRows];
  const byId = new Map(known.map((category) => [category.id, category]));
  const requireKnown = (id: string): void => {
    if (!byId.has(id)) throw new RangeError(`Top-level category ${id} is missing`);
  };
  const periodOfMonth = (month: string): string | null => {
    if (month === periods.month) return 'current';
    return periods.history.includes(month) ? month : null;
  };

  const entries: FlowEntry[] = [];

  for (const { row, amount } of convertRows(personal, displayCurrency, 'throw').items) {
    const period = periodOfMonth(row.month);
    if (period === null) continue;
    if (row.type === 'expense') requireKnown(row.topCategoryId);
    entries.push({
      period,
      kind: row.type,
      categoryId: row.type === 'expense' ? row.topCategoryId : null,
      amount,
    });
  }
  for (const { row, amount } of convertRows(previousPersonal, displayCurrency, 'throw').items) {
    entries.push({ period: 'previous', kind: row.type, categoryId: null, amount });
  }

  const shareEntries = (rows: typeof shares, period: (month: string) => string | null) => {
    const converted = convertRows(rows, displayCurrency, 'count');
    for (const { row, amount } of converted.items) {
      const target = period(row.month);
      if (target === null) continue;
      entries.push({
        period: target,
        kind: 'expense',
        categoryId: matchShareCategory(
          { name: row.categoryName, defaultKey: row.categoryDefaultKey },
          known,
        ),
        amount,
      });
    }
    return converted.unconvertedCount;
  };
  const unconvertedShareCount = shareEntries(
    shares.filter((row) => row.month === periods.month),
    periodOfMonth,
  );
  shareEntries(
    shares.filter((row) => row.month !== periods.month),
    periodOfMonth,
  );
  shareEntries(previousShares, () => 'previous');

  // An installment counts in the month of its due date, and the current month holds the whole
  // month, not only what is due by today (D5). A row can fall in two periods, so each gets a copy.
  const placed: { row: (typeof installments)[number]; period: string }[] = [];
  for (const row of installments) {
    const month = installmentMonthOf(row, historyFrom, periods.monthEnd);
    const period = month === null ? null : periodOfMonth(month);
    if (period !== null) placed.push({ row: { ...row }, period });
    if (installmentMonthOf(row, periods.previousFrom, periods.previousEnd) !== null) {
      placed.push({ row: { ...row }, period: 'previous' });
    }
  }
  const periodByRow = new Map(placed.map(({ row, period }) => [row, period]));
  const installmentEntries = (rows: typeof installments): number => {
    const converted = convertRows(rows, displayCurrency, 'count');
    for (const { row, amount } of converted.items) {
      const period = periodByRow.get(row);
      if (period === undefined) continue;
      if (period !== 'previous') requireKnown(row.topCategoryId);
      entries.push({ period, kind: 'expense', categoryId: row.topCategoryId, amount });
    }
    return converted.unconvertedCount;
  };
  const unconvertedInstallmentCount = installmentEntries(
    placed.filter(({ period }) => period === 'current').map(({ row }) => row),
  );
  installmentEntries(placed.filter(({ period }) => period !== 'current').map(({ row }) => row));

  const fold = foldMonthFlows(entries, periods.history);
  const { current } = fold;
  const net = current.income - current.expenses;
  const previousNet = fold.previous.income - fold.previous.expenses;

  const describe = (categoryId: string | null) => {
    const category = categoryId === null ? undefined : byId.get(categoryId);
    return { categoryId, name: category?.name ?? null, defaultKey: category?.defaultKey ?? null };
  };

  return {
    month: {
      from: periods.first,
      to: context.today,
      expenses: current.expenses,
      income: current.income,
      net,
      change: {
        expenses: jsonChange(current.expenses, fold.previous.expenses),
        income: jsonChange(current.income, fold.previous.income),
        net: jsonChange(net, previousNet),
      },
      unconvertedShareCount,
      unconvertedInstallmentCount,
    },
    categories: current.categories.map((row) => ({
      ...describe(row.categoryId),
      amount: row.amount,
      sharePercent: toJsonInt(row.sharePercent),
    })),
    insight: fold.insight
      ? {
          ...describe(fold.insight.categoryId),
          amount: fold.insight.amount,
          sharePercent: toJsonInt(fold.insight.sharePercent),
          changePercent:
            fold.insight.changePercent === null ? null : toJsonInt(fold.insight.changePercent),
        }
      : null,
  };
}
