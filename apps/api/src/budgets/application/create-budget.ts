import type { CreateBudgetRequest } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { Budget } from '../domain/budget';
import { normalizeThresholds } from '../domain/thresholds';
import { assertBudgetCategories, monthStartFor, type BudgetDependencies } from './dependencies';

export class CreateBudget {
  constructor(private readonly deps: BudgetDependencies) {}

  /** `input` is already parsed by the shared contract; the repository enforces the 50-budget limit. */
  async execute(scope: AccessScope<'write'>, input: CreateBudgetRequest): Promise<Budget> {
    await assertBudgetCategories(this.deps, scope, input.categoryIds);
    const thresholds = normalizeThresholds(input.thresholds);
    const monthStart = await monthStartFor(this.deps, scope.userId);
    return this.deps.budgets.create(
      scope,
      {
        currency: input.currency,
        version: {
          effectiveFrom: monthStart,
          name: input.name,
          amount: BigInt(input.amount),
          rollover: input.rollover ?? false,
          categoryIds: [...input.categoryIds],
          thresholds,
        },
      },
      monthStart,
    );
  }
}
