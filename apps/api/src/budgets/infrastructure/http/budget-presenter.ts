import type { BudgetResponse } from '@pesly/shared';
import type { Budget } from '../../domain/budget';

export function presentBudget(budget: Budget): BudgetResponse {
  return {
    id: budget.id,
    name: budget.version.name,
    amount: budget.version.amount.toString(),
    currency: budget.currency,
    rollover: budget.version.rollover,
    thresholds: budget.version.thresholds,
    categoryIds: budget.version.categoryIds,
    coveredCategoryIds: budget.coveredCategoryIds,
    effectiveFrom: budget.version.effectiveFrom,
    createdAt: budget.createdAt.toISOString(),
  };
}
