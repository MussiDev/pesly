import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { ResourceNotFound, type AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import { violatedConstraint } from '../../../shared/db/pg-errors';
import type { BudgetRepository, NewBudget } from '../../application/ports/budget-repository';
import type { Budget, BudgetVersion } from '../../domain/budget';
import { BudgetLimitReached } from '../../domain/errors';
import { categories } from './foreign-relations';
import {
  budgets,
  budgetVersionCategories,
  budgetVersions,
  budgetVersionThresholds,
} from './schema';

/** The maximum number of budgets one user may hold (DISC-001-06b D8). */
const MAX_BUDGETS_PER_USER = 50;
const CATEGORY_FOREIGN_KEY = 'budget_version_categories_category_owner_kind_fk';

/** The database or one of its transactions. */
type Executor = PgDatabase<NodePgQueryResultHKT>;

/**
 * The category key includes the owner and the kind, so a foreign, income or vanished category
 * violates it (23503). It answers like a missing id, never revealing that the id exists (404).
 */
function categoryKeyAsNotFound(error: unknown): unknown {
  return violatedConstraint(error, '23503') === CATEGORY_FOREIGN_KEY
    ? new ResourceNotFound()
    : error;
}

const ownBudgets = (scope: AccessScope) => scopedTo(scope, { owner: budgets.ownerId });

const ownBudget = (scope: AccessScope, id: string) => and(eq(budgets.id, id), ownBudgets(scope));

/**
 * One version per budget: the greatest `effective_from` not after `monthStart`; a budget whose
 * versions all start later is shown with its earliest one.
 */
async function versionsInForce(
  executor: Executor,
  scope: AccessScope,
  monthStart: string,
  id?: string,
) {
  return executor
    .selectDistinctOn([budgetVersions.budgetId], {
      versionId: budgetVersions.id,
      budgetId: budgetVersions.budgetId,
      ownerId: budgets.ownerId,
      currency: budgets.currency,
      createdAt: budgets.createdAt,
      effectiveFrom: budgetVersions.effectiveFrom,
      name: budgetVersions.name,
      amount: budgetVersions.amount,
      rollover: budgetVersions.rollover,
    })
    .from(budgetVersions)
    .innerJoin(
      budgets,
      and(eq(budgets.id, budgetVersions.budgetId), eq(budgets.ownerId, budgetVersions.ownerId)),
    )
    .where(id === undefined ? ownBudgets(scope) : ownBudget(scope, id))
    .orderBy(
      asc(budgetVersions.budgetId),
      sql`case when ${budgetVersions.effectiveFrom} <= ${monthStart}::date then ${budgetVersions.effectiveFrom} end desc nulls last`,
      asc(budgetVersions.effectiveFrom),
    );
}

/** Reads the budgets in scope (all, or one) with their version in force, categories and thresholds. */
async function loadBudgets(
  executor: Executor,
  scope: AccessScope,
  monthStart: string,
  id?: string,
): Promise<Budget[]> {
  const rows = await versionsInForce(executor, scope, monthStart, id);
  if (rows.length === 0) return [];
  const versionIds = rows.map((row) => row.versionId);
  const selected = await executor
    .select({
      versionId: budgetVersionCategories.versionId,
      categoryId: budgetVersionCategories.categoryId,
    })
    .from(budgetVersionCategories)
    .where(inArray(budgetVersionCategories.versionId, versionIds));
  const percents = await executor
    .select({
      versionId: budgetVersionThresholds.versionId,
      percent: budgetVersionThresholds.percent,
    })
    .from(budgetVersionThresholds)
    .where(inArray(budgetVersionThresholds.versionId, versionIds))
    .orderBy(asc(budgetVersionThresholds.percent));

  // Children are read at query time inside the owner's scope, so one created later is covered.
  const selectedIds = [...new Set(selected.map((row) => row.categoryId))];
  const children =
    selectedIds.length === 0
      ? []
      : await executor
          .select({ id: categories.id, parentId: categories.parentId })
          .from(categories)
          .where(
            and(
              inArray(categories.parentId, selectedIds),
              scopedTo(scope, { owner: categories.ownerId }),
            ),
          );

  return rows
    .map((row) => {
      const categoryIds = selected
        .filter((entry) => entry.versionId === row.versionId)
        .map((entry) => entry.categoryId);
      const covered = new Set(categoryIds);
      for (const child of children) {
        if (child.parentId !== null && categoryIds.includes(child.parentId)) covered.add(child.id);
      }
      return {
        id: row.budgetId,
        ownerId: row.ownerId,
        currency: row.currency,
        createdAt: row.createdAt,
        version: {
          effectiveFrom: row.effectiveFrom,
          name: row.name,
          amount: row.amount,
          rollover: row.rollover,
          categoryIds,
          thresholds: percents
            .filter((entry) => entry.versionId === row.versionId)
            .map((entry) => entry.percent),
        },
        coveredCategoryIds: [...covered],
      };
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

async function insertVersion(
  executor: Executor,
  ownerId: string,
  budgetId: string,
  version: BudgetVersion,
): Promise<void> {
  const [row] = await executor
    .insert(budgetVersions)
    .values({
      budgetId,
      ownerId,
      effectiveFrom: version.effectiveFrom,
      name: version.name,
      amount: version.amount,
      rollover: version.rollover,
    })
    .returning({ id: budgetVersions.id });
  if (!row) throw new Error('Inserting a budget version returned no row');
  await executor
    .insert(budgetVersionCategories)
    .values(version.categoryIds.map((categoryId) => ({ versionId: row.id, ownerId, categoryId })));
  await executor
    .insert(budgetVersionThresholds)
    .values(version.thresholds.map((percent) => ({ versionId: row.id, ownerId, percent })));
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Reading the ${what} just written returned no row`);
  return value;
}

export class DrizzleBudgetRepository implements BudgetRepository {
  constructor(private readonly db: Database) {}

  async create(scope: AccessScope<'write'>, data: NewBudget, monthStart: string): Promise<Budget> {
    try {
      return await this.db.transaction(async (tx) => {
        // Serializes the creates of one owner so two at 49 budgets cannot both pass the count.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`budgets:limit:${scope.userId}`}, 0))`,
        );
        const [owned] = await tx.select({ total: count() }).from(budgets).where(ownBudgets(scope));
        if ((owned?.total ?? 0) >= MAX_BUDGETS_PER_USER) throw new BudgetLimitReached();
        const [row] = await tx
          .insert(budgets)
          .values({ ownerId: scope.userId, currency: data.currency })
          .returning({ id: budgets.id });
        if (!row) throw new Error('Inserting a budget returned no row');
        await insertVersion(tx, scope.userId, row.id, data.version);
        const [created] = await loadBudgets(tx, scope, monthStart, row.id);
        return required(created, 'budget');
      });
    } catch (error) {
      throw categoryKeyAsNotFound(error);
    }
  }

  async findById(scope: AccessScope, id: string, monthStart: string): Promise<Budget | null> {
    const [found] = await loadBudgets(this.db, scope, monthStart, id);
    return found ?? null;
  }

  listCurrent(scope: AccessScope, monthStart: string): Promise<Budget[]> {
    return loadBudgets(this.db, scope, monthStart);
  }

  async update(
    scope: AccessScope<'write'>,
    id: string,
    monthStart: string,
    change: (current: BudgetVersion) => BudgetVersion,
  ): Promise<Budget | null> {
    try {
      return await this.db.transaction(async (tx) => {
        // The row lock also serializes two edits of the same budget, so the one-version-per-month
        // replacement below cannot race with itself.
        const [own] = await tx
          .select({ id: budgets.id })
          .from(budgets)
          .where(ownBudget(scope, id))
          .for('update');
        if (!own) return null;
        // Read under the lock, so a concurrent edit committed meanwhile is part of what is merged.
        const [existing] = await loadBudgets(tx, scope, monthStart, id);
        const version = change(required(existing, 'budget').version);
        await tx
          .delete(budgetVersions)
          .where(
            and(
              eq(budgetVersions.budgetId, id),
              eq(budgetVersions.ownerId, scope.userId),
              eq(budgetVersions.effectiveFrom, version.effectiveFrom),
            ),
          );
        await insertVersion(tx, scope.userId, id, version);
        await tx
          .update(budgets)
          .set({ updatedAt: sql`now()` })
          .where(ownBudget(scope, id));
        const [updated] = await loadBudgets(tx, scope, monthStart, id);
        return required(updated, 'budget');
      });
    } catch (error) {
      throw categoryKeyAsNotFound(error);
    }
  }

  async delete(scope: AccessScope<'write'>, id: string): Promise<boolean> {
    const removed = await this.db
      .delete(budgets)
      .where(ownBudget(scope, id))
      .returning({ id: budgets.id });
    return removed.length > 0;
  }
}
