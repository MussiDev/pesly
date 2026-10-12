import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { Budget } from '../domain/budget';
import { monthStartFor, type BudgetDependencies } from './dependencies';

export class GetBudget {
  constructor(private readonly deps: BudgetDependencies) {}

  async execute(scope: AccessScope, id: string): Promise<Budget> {
    const monthStart = await monthStartFor(this.deps, scope.userId);
    return notFoundUnlessAllowed(await this.deps.budgets.findById(scope, id, monthStart));
  }
}
