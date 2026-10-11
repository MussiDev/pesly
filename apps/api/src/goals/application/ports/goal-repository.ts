import type { AccountCurrency } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';
import type { Goal, GoalEntry, GoalEntryKind } from '../../domain/goal';

export interface NewGoal {
  name: string;
  targetAmount: bigint;
  currency: AccountCurrency;
  targetDate: string | null;
  accountId: string | null;
}

/** An omitted key stays as it is; `targetDate: null` removes the date. */
export interface GoalChanges {
  name?: string;
  targetAmount?: bigint;
  targetDate?: string | null;
}

export interface RecordedEntry {
  entry: GoalEntry;
  /** Progress of the goal after the entry. */
  progress: bigint;
}

/**
 * Every method takes the scope first; a row outside it is indistinguishable from a missing one
 * (`null` / `false`).
 */
export interface GoalRepository {
  /** Enforces the per-user limit atomically: `GoalLimitReached` over `MAX_GOALS`. */
  create(scope: AccessScope<'write'>, data: NewGoal): Promise<Goal>;
  /** Oldest first. */
  list(scope: AccessScope): Promise<Goal[]>;
  findById(scope: AccessScope, id: string): Promise<Goal | null>;
  update(scope: AccessScope<'write'>, id: string, changes: GoalChanges): Promise<Goal | null>;
  /** Removes the goal and its entries. `false` when nothing in scope matched. */
  delete(scope: AccessScope<'write'>, id: string): Promise<boolean>;
  /** Entries sum (contributions minus withdrawals) per unlinked goal of the scope; linked ids are absent. */
  progressOf(scope: AccessScope, goalIds: readonly string[]): Promise<Map<string, bigint>>;
  /**
   * Atomic (row lock): throws `GoalLinkedToAccount` on a linked goal, `GoalWithdrawalExceedsProgress`
   * above the progress and `GoalProgressTooLarge` over the largest amount. `null` when no goal matched.
   */
  recordEntry(
    scope: AccessScope<'write'>,
    goalId: string,
    kind: GoalEntryKind,
    amount: bigint,
  ): Promise<RecordedEntry | null>;
  /** Newest first, at most `limit`; `null` when the goal is not in scope. */
  listEntries(scope: AccessScope, goalId: string, limit: number): Promise<GoalEntry[] | null>;
}
