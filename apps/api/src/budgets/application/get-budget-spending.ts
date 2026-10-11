import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import { computeSpending, type BudgetSpending } from './compute-spending';
import type { SpendingDependencies } from './dependencies';

export class GetBudgetSpending {
  constructor(private readonly deps: SpendingDependencies) {}

  /** 404 when the budget is missing, foreign or had no version in force that month (AC-17). */
  async execute(scope: AccessScope, id: string, month?: string): Promise<BudgetSpending> {
    const result = await computeSpending(this.deps, scope, month, id);
    return notFoundUnlessAllowed(result.budgets[0]);
  }
}
