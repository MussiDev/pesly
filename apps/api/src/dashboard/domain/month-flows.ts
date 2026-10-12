import { addToCategory, orderCategoryTotals } from '../../reports';
import { insightChange, wholePercent } from './percent';

/**
 * One converted amount. `period` is `'current'` (the month to date), `'previous'` (the same days
 * of the previous month) or the `YYYY-MM` of one of the three complete months.
 */
export interface FlowEntry {
  period: string;
  kind: 'income' | 'expense';
  /** The top-level category; null for the shares that match no personal category. */
  categoryId: string | null;
  amount: bigint;
}

export interface CategoryShare {
  categoryId: string | null;
  amount: bigint;
  sharePercent: bigint;
}

export interface MonthInsight extends CategoryShare {
  changePercent: bigint | null;
}

export interface MonthFold {
  current: { expenses: bigint; income: bigint; categories: CategoryShare[] };
  previous: { expenses: bigint; income: bigint };
  insight: MonthInsight | null;
}

const COMPLETE_MONTHS = 3;

/** Folds converted entries into the month, its categories and the insight (D6, D7). */
export function foldMonthFlows(
  entries: readonly FlowEntry[],
  history: readonly string[],
): MonthFold {
  let expenses = 0n;
  let income = 0n;
  let previousExpenses = 0n;
  let previousIncome = 0n;
  const currentCategories = new Map<string | null, bigint>();
  const byMonth = new Map<string, Map<string | null, bigint>>(
    history.map((month) => [month, new Map<string | null, bigint>()]),
  );

  for (const entry of entries) {
    if (entry.period === 'current') {
      if (entry.kind === 'income') {
        income += entry.amount;
      } else {
        expenses += entry.amount;
        addToCategory(currentCategories, entry.categoryId, entry.amount);
      }
    } else if (entry.period === 'previous') {
      if (entry.kind === 'income') previousIncome += entry.amount;
      else previousExpenses += entry.amount;
    } else if (entry.kind === 'expense') {
      const month = byMonth.get(entry.period);
      if (month) addToCategory(month, entry.categoryId, entry.amount);
    }
  }

  const categories = orderCategoryTotals(currentCategories).map((row) => ({
    categoryId: row.categoryId,
    amount: row.amount,
    sharePercent: wholePercent(row.amount, expenses),
  }));

  const [top] = categories;
  let insight: MonthInsight | null = null;
  if (top) {
    const monthsWithExpenses = [...byMonth.values()].filter((totals) =>
      [...totals.values()].some((amount) => amount > 0n),
    ).length;
    const sum3 = [...byMonth.values()].reduce(
      (sum, totals) => sum + (totals.get(top.categoryId) ?? 0n),
      0n,
    );
    insight = {
      ...top,
      changePercent: monthsWithExpenses < COMPLETE_MONTHS ? null : insightChange(top.amount, sum3),
    };
  }

  return {
    current: { expenses, income, categories },
    previous: { expenses: previousExpenses, income: previousIncome },
    insight,
  };
}
