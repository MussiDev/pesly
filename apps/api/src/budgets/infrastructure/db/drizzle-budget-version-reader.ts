import { and, asc, desc, eq, inArray, lte, or } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type {
  BudgetVersionReader,
  BudgetVersions,
  CoveredCategory,
  VersionInForce,
} from '../../application/ports/budget-version-reader';
import type { BudgetVersion } from '../../domain/budget';
import { monthStartOf } from '../../domain/month';
import { categories } from './foreign-relations';
import {
  budgets,
  budgetVersionCategories,
  budgetVersions,
  budgetVersionThresholds,
} from './schema';

export class DrizzleBudgetVersionReader implements BudgetVersionReader {
  constructor(private readonly db: Database) {}

  async forMonths(
    scope: AccessScope,
    months: readonly string[],
    budgetId?: string,
  ): Promise<BudgetVersions[]> {
    if (months.length === 0) return [];
    const owned = await this.db
      .select({ id: budgets.id, currency: budgets.currency, createdAt: budgets.createdAt })
      .from(budgets)
      .where(
        and(
          scopedTo(scope, { owner: budgets.ownerId }),
          budgetId === undefined ? undefined : eq(budgets.id, budgetId),
        ),
      )
      .orderBy(asc(budgets.createdAt), asc(budgets.id));
    if (owned.length === 0) return [];
    const budgetIds = owned.map((row) => row.id);

    // One statement per month asked (one or two), never one per budget.
    const inForce = new Map<string, Map<string, { id: string; version: BudgetVersion }>>();
    for (const month of months) {
      const rows = await this.db
        .selectDistinctOn([budgetVersions.budgetId], {
          id: budgetVersions.id,
          budgetId: budgetVersions.budgetId,
          effectiveFrom: budgetVersions.effectiveFrom,
          name: budgetVersions.name,
          amount: budgetVersions.amount,
          rollover: budgetVersions.rollover,
        })
        .from(budgetVersions)
        .where(
          and(
            inArray(budgetVersions.budgetId, budgetIds),
            scopedTo(scope, { owner: budgetVersions.ownerId }),
            lte(budgetVersions.effectiveFrom, monthStartOf(month)),
          ),
        )
        .orderBy(asc(budgetVersions.budgetId), desc(budgetVersions.effectiveFrom));
      inForce.set(
        month,
        new Map(
          rows.map((row) => [
            row.budgetId,
            {
              id: row.id,
              version: {
                effectiveFrom: row.effectiveFrom,
                name: row.name,
                amount: row.amount,
                rollover: row.rollover,
                categoryIds: [],
                thresholds: [],
              },
            },
          ]),
        ),
      );
    }

    const versionIds = [
      ...new Set(
        [...inForce.values()].flatMap((byBudget) => [...byBudget.values()].map((v) => v.id)),
      ),
    ];
    if (versionIds.length === 0) return owned.map((row) => emptyEntry(row, months));

    const selected = await this.db
      .select({
        versionId: budgetVersionCategories.versionId,
        categoryId: budgetVersionCategories.categoryId,
      })
      .from(budgetVersionCategories)
      .where(inArray(budgetVersionCategories.versionId, versionIds));
    const percents = await this.db
      .select({
        versionId: budgetVersionThresholds.versionId,
        percent: budgetVersionThresholds.percent,
      })
      .from(budgetVersionThresholds)
      .where(inArray(budgetVersionThresholds.versionId, versionIds))
      .orderBy(asc(budgetVersionThresholds.percent));

    // The selected categories and their children, read now and inside the scope, so a
    // subcategory created later is covered in past months too (06b D5).
    const selectedIds = [...new Set(selected.map((row) => row.categoryId))];
    const categoryRows =
      selectedIds.length === 0
        ? []
        : await this.db
            .select({
              id: categories.id,
              parentId: categories.parentId,
              name: categories.name,
              defaultKey: categories.defaultKey,
            })
            .from(categories)
            .where(
              and(
                or(inArray(categories.id, selectedIds), inArray(categories.parentId, selectedIds)),
                scopedTo(scope, { owner: categories.ownerId }),
              ),
            );

    const coveredOf = (categoryIds: readonly string[]): CoveredCategory[] =>
      categoryRows
        .filter(
          (row) =>
            categoryIds.includes(row.id) ||
            (row.parentId !== null && categoryIds.includes(row.parentId)),
        )
        .map((row) => ({ id: row.id, name: row.name, defaultKey: row.defaultKey }));

    const resolved = (entry: { id: string; version: BudgetVersion }): VersionInForce => {
      const categoryIds = selected
        .filter((row) => row.versionId === entry.id)
        .map((row) => row.categoryId);
      return {
        version: {
          ...entry.version,
          categoryIds,
          thresholds: percents
            .filter((row) => row.versionId === entry.id)
            .map((row) => row.percent),
        },
        covered: coveredOf(categoryIds),
      };
    };

    return owned.map((row) => ({
      budgetId: row.id,
      currency: row.currency,
      createdAt: row.createdAt,
      byMonth: new Map(
        months.map((month) => {
          const entry = inForce.get(month)?.get(row.id);
          return [month, entry === undefined ? null : resolved(entry)];
        }),
      ),
    }));
  }
}

function emptyEntry(
  row: { id: string; currency: BudgetVersions['currency']; createdAt: Date },
  months: readonly string[],
): BudgetVersions {
  return {
    budgetId: row.id,
    currency: row.currency,
    createdAt: row.createdAt,
    byMonth: new Map(months.map((month) => [month, null])),
  };
}
