import type {
  ExpensesByCategoryResponse,
  IncomeExpensesResponse,
  NetWorthResponse,
} from '@pesly/shared';
import type { Locale } from '@/i18n/routing';
import { categoryRowLabel, type CategoryNameLabels } from './category-names';
import type {
  CategoriesView,
  CategoryRowView,
  IncomeExpensesView,
  NetWorthView,
} from './report-view';
import { computeShares } from './shares';

/** Amounts arrive as integer strings already checked by the api-client's response parser. */
function toAmount(text: string): bigint {
  return BigInt(text);
}

/** Rows from the largest amount; equal amounts keep the locale's order of their labels. */
export function toCategoriesView(
  response: ExpensesByCategoryResponse,
  locale: Locale,
  labels: CategoryNameLabels,
): CategoriesView {
  const total = toAmount(response.total);
  const sorted = response.categories
    .map((row, index) => ({
      key: row.categoryId ?? row.defaultKey ?? `row-${index}`,
      label: categoryRowLabel(row, locale, labels),
      amount: toAmount(row.amount),
    }))
    .sort((a, b) =>
      a.amount === b.amount ? a.label.localeCompare(b.label, locale) : a.amount > b.amount ? -1 : 1,
    );
  const shares = computeShares(sorted, total);
  const rows: CategoryRowView[] = sorted.map((row, index) => ({
    ...row,
    percent: shares[index]?.percent ?? 0,
    underOne: shares[index]?.underOne ?? false,
  }));
  return {
    currency: response.currency,
    from: response.from,
    to: response.to,
    total,
    rows,
    unconvertedShareCount: response.unconvertedShareCount,
    unconvertedInstallmentCount: response.unconvertedInstallmentCount,
  };
}

export function toIncomeExpensesView(response: IncomeExpensesResponse): IncomeExpensesView {
  return {
    currency: response.currency,
    from: response.from,
    to: response.to,
    months: response.months.map((month) => {
      const income = toAmount(month.income);
      const expenses = toAmount(month.expenses);
      return { month: month.month, income, expenses, net: income - expenses };
    }),
    unconvertedShareCount: response.unconvertedShareCount,
    unconvertedInstallmentCount: response.unconvertedInstallmentCount,
  };
}

export function toNetWorthView(response: NetWorthResponse): NetWorthView {
  return {
    currency: response.currency,
    from: response.from,
    to: response.to,
    points: response.points.map((point) => ({
      date: point.date,
      ars: toAmount(point.ars),
      usd: toAmount(point.usd),
      total: point.total === null ? null : toAmount(point.total),
      reason: point.reason,
      incomplete: point.investmentsIncomplete,
    })),
  };
}
