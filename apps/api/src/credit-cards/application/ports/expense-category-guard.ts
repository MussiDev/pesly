import type { AccessScope } from '../../../shared/access';

/**
 * Checks that a category can carry a new expense: the caller's own, of kind expense and not
 * archived. The movements module implements it so the movement rules apply unchanged (spec D7).
 * Throws `ResourceNotFound`, `MovementCategoryKindMismatch` or `CategoryArchived`.
 */
export interface ExpenseCategoryGuard {
  assertOpenExpenseCategory(scope: AccessScope<'write'>, categoryId: string): Promise<void>;
}
