import type { AccessScope } from '../../shared/access';
import type { Budget } from '../domain/budget';
import { monthStartFor, type BudgetDependencies } from './dependencies';

export class ListBudgets {
  constructor(private readonly deps: BudgetDependencies) {}

  async execute(scope: AccessScope): Promise<Budget[]> {
    return this.deps.budgets.listCurrent(scope, await monthStartFor(this.deps, scope.userId));
  }
}
