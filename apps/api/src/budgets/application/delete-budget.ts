import { ResourceNotFound, type AccessScope } from '../../shared/access';
import type { BudgetDependencies } from './dependencies';

export class DeleteBudget {
  constructor(private readonly deps: Pick<BudgetDependencies, 'budgets'>) {}

  async execute(scope: AccessScope<'write'>, id: string): Promise<void> {
    if (!(await this.deps.budgets.delete(scope, id))) throw new ResourceNotFound();
  }
}
