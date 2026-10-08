import type { ExpenseCategoryGuard } from '../../../credit-cards/application/ports/expense-category-guard';
import { notFoundUnlessAllowed, type AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import { CategoryArchived, MovementCategoryKindMismatch } from '../../domain/errors';
import { DrizzleCategoryLookup } from '../db/drizzle-category-lookup';

/**
 * The category rules movements apply to a new expense (spec D7): the caller's own category (404
 * otherwise), of kind expense, not archived.
 */
class MovementsExpenseCategoryGuard implements ExpenseCategoryGuard {
  constructor(private readonly categories: DrizzleCategoryLookup) {}

  async assertOpenExpenseCategory(scope: AccessScope<'write'>, categoryId: string): Promise<void> {
    const category = notFoundUnlessAllowed(await this.categories.find(scope, categoryId));
    if (category.kind !== 'expense') throw new MovementCategoryKindMismatch();
    if (category.archived) throw new CategoryArchived();
  }
}

export function createExpenseCategoryGuard(db: Database): ExpenseCategoryGuard {
  return new MovementsExpenseCategoryGuard(new DrizzleCategoryLookup(db));
}
