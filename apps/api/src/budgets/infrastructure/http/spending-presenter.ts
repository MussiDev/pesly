import type { BudgetSpendingResponse } from '@pesly/shared';
import type { BudgetSpending } from '../../application/compute-spending';

/** Money leaves as exact integer strings; `percentUsed` is already an integer. */
export function presentBudgetSpending(spending: BudgetSpending): BudgetSpendingResponse {
  return {
    budgetId: spending.budgetId,
    name: spending.name,
    currency: spending.currency,
    month: spending.month,
    amount: spending.amount.toString(),
    rolloverEnabled: spending.rolloverEnabled,
    rolloverAmount: spending.rolloverAmount.toString(),
    available: spending.available.toString(),
    spent: spending.spent.toString(),
    remaining: spending.remaining.toString(),
    percentUsed: spending.percentUsed,
    thresholds: spending.thresholds,
    unconvertedShareCount: spending.unconvertedShareCount,
    unconvertedInstallmentCount: spending.unconvertedInstallmentCount,
  };
}
