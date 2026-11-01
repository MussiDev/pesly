import type { CardCategoryRule } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';

/**
 * The category the user gave each merchant on earlier statement imports (FEAT-016). Every method
 * filters by the scope's owner in the same statement.
 */
export interface CardCategoryRules {
  /** The caller's rules, ordered by merchant key. */
  list(scope: AccessScope): Promise<CardCategoryRule[]>;
  /** Stores each rule, replacing the category of a merchant the caller already has a rule for. */
  learn(scope: AccessScope<'write'>, rules: readonly CardCategoryRule[]): Promise<void>;
}
