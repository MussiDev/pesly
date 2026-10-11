import type { AccessScope } from '../../shared/access';
import { computeSpending, type BudgetSpending } from './compute-spending';
import type { SpendingDependencies } from './dependencies';

export class ListBudgetSpending {
  constructor(private readonly deps: SpendingDependencies) {}

  /** Every budget of the caller that existed in the month, in creation order. */
  execute(
    scope: AccessScope,
    month?: string,
  ): Promise<{ month: string; budgets: BudgetSpending[] }> {
    return computeSpending(this.deps, scope, month);
  }
}
