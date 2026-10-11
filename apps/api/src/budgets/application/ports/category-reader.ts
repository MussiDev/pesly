import type { CategoryKind } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';

export interface BudgetCategoryRef {
  id: string;
  kind: CategoryKind;
  archived: boolean;
}

/** Read-only view of the caller's categories, for validating a budget's category set. */
export interface CategoryReader {
  /** Only the ids inside the scope come back; unknown and foreign ids are simply absent. */
  findMany(scope: AccessScope, ids: readonly string[]): Promise<BudgetCategoryRef[]>;
}
