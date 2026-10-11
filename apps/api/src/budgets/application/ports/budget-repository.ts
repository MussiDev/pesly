import type { BudgetCurrency } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';
import type { Budget, BudgetVersion } from '../../domain/budget';

export interface NewBudget {
  currency: BudgetCurrency;
  /** The first version, effective from the first day of the current month. */
  version: BudgetVersion;
}

/**
 * Every method takes the scope first; a row outside it is indistinguishable from a missing one
 * (`null` / `false`). Reads return the version in force for `monthStart` (a budget whose first
 * version starts later is shown with that first version) with its categories, thresholds and the
 * covered categories computed inside the same owner scope.
 */
export interface BudgetRepository {
  /**
   * Writes the budget and its first version in one transaction that first takes the per-owner lock
   * and counts the owner's budgets. Raises `BudgetLimitReached` at 50.
   */
  create(scope: AccessScope<'write'>, data: NewBudget, monthStart: string): Promise<Budget>;
  findById(scope: AccessScope, id: string, monthStart: string): Promise<Budget | null>;
  /** Ordered by creation, then id. */
  listCurrent(scope: AccessScope, monthStart: string): Promise<Budget[]>;
  /**
   * Replaces the version of `version.effectiveFrom` if it exists, otherwise inserts it, in one
   * transaction. Earlier versions are never touched. `null` when the budget is not in scope.
   */
  update(
    scope: AccessScope<'write'>,
    id: string,
    version: BudgetVersion,
    monthStart: string,
  ): Promise<Budget | null>;
  /** `false` when nothing in scope matched. Versions, categories and thresholds cascade. */
  delete(scope: AccessScope<'write'>, id: string): Promise<boolean>;
}
