import type { UpdateBudgetRequest } from '@pesly/shared';
import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import { mergeVersion, type Budget } from '../domain/budget';
import { normalizeThresholds } from '../domain/thresholds';
import { assertBudgetCategories, monthStartFor, type BudgetDependencies } from './dependencies';

export class UpdateBudget {
  constructor(private readonly deps: BudgetDependencies) {}

  /**
   * Writes the version of the caller's current month (D2), even when nothing changes. Only a
   * changed category set is re-validated, so a budget over a since-archived category stays editable.
   */
  async execute(
    scope: AccessScope<'write'>,
    id: string,
    input: UpdateBudgetRequest,
  ): Promise<Budget> {
    const monthStart = await monthStartFor(this.deps, scope.userId);
    // Existence check only: the version to merge into is read again under the row lock.
    notFoundUnlessAllowed(await this.deps.budgets.findById(scope, id, monthStart));
    if (input.categoryIds !== undefined) {
      await assertBudgetCategories(this.deps, scope, input.categoryIds);
    }
    const changes = {
      name: input.name,
      amount: input.amount === undefined ? undefined : BigInt(input.amount),
      rollover: input.rollover,
      categoryIds: input.categoryIds,
      thresholds:
        input.thresholds === undefined ? undefined : normalizeThresholds(input.thresholds),
    };
    return notFoundUnlessAllowed(
      await this.deps.budgets.update(scope, id, monthStart, (current) =>
        mergeVersion(current, changes, monthStart),
      ),
    );
  }
}
