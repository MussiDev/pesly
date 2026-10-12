import type { BudgetCurrency } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';
import type { BudgetVersion } from '../../domain/budget';

/** A category a budget covers, with the names it answers to (custom name or default key). */
export interface CoveredCategory {
  id: string;
  name: string | null;
  defaultKey: string | null;
}

/** The version of a budget in force for one month, with the categories it covered then. */
export interface VersionInForce {
  version: BudgetVersion;
  /** The selected categories plus the subcategories of every selected parent, read now (06b D5). */
  covered: CoveredCategory[];
}

export interface BudgetVersions {
  budgetId: string;
  currency: BudgetCurrency;
  createdAt: Date;
  /**
   * For every month asked (`YYYY-MM`): the version in force, or null when the budget did not
   * exist yet that month (every version starts later).
   */
  byMonth: ReadonlyMap<string, VersionInForce | null>;
}

export interface BudgetVersionReader {
  /**
   * The caller's budgets (or just `budgetId`) in creation order, each with its version in force
   * for every month in `months`. A missing or foreign `budgetId` gives an empty list. Fixed number
   * of statements whatever the number of budgets.
   */
  forMonths(
    scope: AccessScope,
    months: readonly string[],
    budgetId?: string,
  ): Promise<BudgetVersions[]>;
}
