import { MOVEMENT_AMOUNT_MAX_MINOR_UNITS } from '@pesly/shared';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ResourceNotFound, type AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import { violatedConstraint } from '../../../shared/db/pg-errors';
import type {
  GoalChanges,
  GoalRepository,
  NewGoal,
  RecordedEntry,
} from '../../application/ports/goal-repository';
import {
  GoalLimitReached,
  GoalLinkedToAccount,
  GoalProgressTooLarge,
  GoalWithdrawalExceedsProgress,
} from '../../domain/errors';
import { MAX_GOALS, type Goal, type GoalEntry, type GoalEntryKind } from '../../domain/goal';
import { goalEntries, goals } from './schema';

const ACCOUNT_OWNER_CONSTRAINT = 'goals_account_owner_fk';

const goalColumns = {
  id: goals.id,
  name: goals.name,
  targetAmount: goals.targetAmount,
  currency: goals.currency,
  targetDate: goals.targetDate,
  accountId: goals.linkedAccountId,
  createdAt: goals.createdAt,
};

const entryColumns = {
  id: goalEntries.id,
  kind: goalEntries.kind,
  amount: goalEntries.amount,
  createdAt: goalEntries.createdAt,
};

const inScope = (scope: AccessScope) => scopedTo(scope, { owner: goals.ownerId });

/** This row, and only if the scope covers it, in the same statement. */
const scopedGoal = (scope: AccessScope, id: string) => and(eq(goals.id, id), inScope(scope));

/** Contributions minus withdrawals as text: `sum(bigint)` is numeric and must not go through a float. */
const progressSql = sql<string>`coalesce(sum(case ${goalEntries.kind} when 'contribution' then ${goalEntries.amount} else -${goalEntries.amount} end), 0)::text`;

export class DrizzleGoalRepository implements GoalRepository {
  constructor(private readonly db: Database) {}

  async create(scope: AccessScope<'write'>, data: NewGoal): Promise<Goal> {
    try {
      return await this.db.transaction(async (tx) => {
        // One lock per owner, released at commit: two creates cannot both count 99 goals.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`goals:${scope.userId}`}, 0))`,
        );
        const [owned] = await tx
          .select({ total: count() })
          .from(goals)
          .where(eq(goals.ownerId, scope.userId));
        if ((owned?.total ?? 0) >= MAX_GOALS) throw new GoalLimitReached();
        const [row] = await tx
          .insert(goals)
          .values({
            ownerId: scope.userId,
            name: data.name,
            targetAmount: data.targetAmount,
            currency: data.currency,
            targetDate: data.targetDate,
            linkedAccountId: data.accountId,
          })
          .returning(goalColumns);
        if (!row) throw new Error('Inserting a goal returned no row');
        return row;
      });
    } catch (error) {
      // The composite key is the backstop of the use case's ownership check: a foreign account.
      if (violatedConstraint(error, '23503') === ACCOUNT_OWNER_CONSTRAINT) {
        throw new ResourceNotFound();
      }
      throw error;
    }
  }

  async list(scope: AccessScope): Promise<Goal[]> {
    return this.db
      .select(goalColumns)
      .from(goals)
      .where(inScope(scope))
      .orderBy(asc(goals.createdAt), asc(goals.id));
  }

  async findById(scope: AccessScope, id: string): Promise<Goal | null> {
    const [row] = await this.db
      .select(goalColumns)
      .from(goals)
      .where(scopedGoal(scope, id))
      .limit(1);
    return row ?? null;
  }

  async update(
    scope: AccessScope<'write'>,
    id: string,
    changes: GoalChanges,
  ): Promise<Goal | null> {
    const [row] = await this.db
      .update(goals)
      .set({
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.targetAmount !== undefined && { targetAmount: changes.targetAmount }),
        ...(changes.targetDate !== undefined && { targetDate: changes.targetDate }),
        updatedAt: sql`now()`,
      })
      .where(scopedGoal(scope, id))
      .returning(goalColumns);
    return row ?? null;
  }

  async delete(scope: AccessScope<'write'>, id: string): Promise<boolean> {
    // The entries go by the cascading key; no account or movement is touched.
    const rows = await this.db
      .delete(goals)
      .where(scopedGoal(scope, id))
      .returning({ id: goals.id });
    return rows.length === 1;
  }

  async progressOf(scope: AccessScope, goalIds: readonly string[]): Promise<Map<string, bigint>> {
    const progress = new Map<string, bigint>();
    if (goalIds.length === 0) return progress;
    const rows = await this.db
      .select({ id: goals.id, total: progressSql })
      .from(goals)
      .leftJoin(goalEntries, eq(goalEntries.goalId, goals.id))
      .where(and(inArray(goals.id, [...goalIds]), isNull(goals.linkedAccountId), inScope(scope)))
      .groupBy(goals.id);
    for (const row of rows) progress.set(row.id, BigInt(row.total));
    return progress;
  }

  async recordEntry(
    scope: AccessScope<'write'>,
    goalId: string,
    kind: GoalEntryKind,
    amount: bigint,
  ): Promise<RecordedEntry | null> {
    return this.db.transaction(async (tx) => {
      // The row lock serializes every entry of this goal, so the sum below is the one that stays true.
      const [goal] = await tx
        .select({ id: goals.id, linkedAccountId: goals.linkedAccountId })
        .from(goals)
        .where(scopedGoal(scope, goalId))
        .limit(1)
        .for('update');
      if (!goal) return null;
      if (goal.linkedAccountId !== null) throw new GoalLinkedToAccount();

      const [sum] = await tx
        .select({ total: progressSql })
        .from(goalEntries)
        .where(eq(goalEntries.goalId, goalId));
      const current = BigInt(sum?.total ?? '0');
      const progress = kind === 'contribution' ? current + amount : current - amount;
      if (kind === 'withdrawal' && progress < 0n) throw new GoalWithdrawalExceedsProgress();
      if (progress > MOVEMENT_AMOUNT_MAX_MINOR_UNITS) throw new GoalProgressTooLarge();

      const [entry] = await tx
        .insert(goalEntries)
        .values({ goalId, ownerId: scope.userId, kind, amount })
        .returning(entryColumns);
      if (!entry) throw new Error('Inserting a goal entry returned no row');
      return { entry, progress };
    });
  }

  async listEntries(
    scope: AccessScope,
    goalId: string,
    limit: number,
  ): Promise<GoalEntry[] | null> {
    const [goal] = await this.db
      .select({ id: goals.id })
      .from(goals)
      .where(scopedGoal(scope, goalId))
      .limit(1);
    if (!goal) return null;
    return this.db
      .select(entryColumns)
      .from(goalEntries)
      .where(eq(goalEntries.goalId, goalId))
      .orderBy(desc(goalEntries.createdAt), desc(goalEntries.id))
      .limit(limit);
  }
}
