import type { BudgetCurrency } from '@pesly/shared';

export const BUDGET_HIGHLIGHT_LIMIT = 3;
const CLOSE_FROM_PERCENT = 80;
const OVER_FROM_PERCENT = 100;

export type BudgetHighlightStatus = 'on_track' | 'close' | 'over';

/** What the section needs of one budget's spending (a subset of the budgets module result). */
export interface BudgetHighlightInput {
  budgetId: string;
  name: string;
  currency: BudgetCurrency;
  available: bigint;
  spent: bigint;
  percentUsed: number;
}

export interface BudgetHighlight extends BudgetHighlightInput {
  status: BudgetHighlightStatus;
}

/** D8: below 80 on track, 80 to 99 close, from 100 over. */
export function budgetStatus(percentUsed: number): BudgetHighlightStatus {
  if (percentUsed >= OVER_FROM_PERCENT) return 'over';
  if (percentUsed >= CLOSE_FROM_PERCENT) return 'close';
  return 'on_track';
}

/**
 * The budgets closest to their limit, compared by percentage only (each keeps its own currency).
 * The sort is stable, so on a tie the budget that comes first in the input (the older one) wins.
 */
export function topBudgets(budgets: readonly BudgetHighlightInput[]): BudgetHighlight[] {
  return [...budgets]
    .sort((a, b) => b.percentUsed - a.percentUsed)
    .slice(0, BUDGET_HIGHLIGHT_LIMIT)
    .map((budget) => ({
      budgetId: budget.budgetId,
      name: budget.name,
      currency: budget.currency,
      available: budget.available,
      spent: budget.spent,
      percentUsed: budget.percentUsed,
      status: budgetStatus(budget.percentUsed),
    }));
}
