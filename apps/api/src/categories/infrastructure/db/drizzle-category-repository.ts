import { and, asc, count, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { CategoryKind } from '@pesly/shared';
import type {
  CategoryRepository,
  CategoryTransaction,
  InsertCategoryData,
  ListCategoriesOptions,
  UpdateCategoryFields,
} from '../../application/ports/category-repository';
import type { Category } from '../../domain/category';
import { CategoryInUse, CategoryNameTaken } from '../../domain/errors';
import { ResourceNotFound, type AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import { violatedConstraint } from '../../../shared/db/pg-errors';
import { categories, categoryDefaultsSeeded } from './schema';
import { seedDefaultCategories, type SeedDatabase } from './seed-default-categories';

const NAME_UNIQUE_CONSTRAINT = 'categories_owner_name_unique';
const PARENT_FOREIGN_KEY = 'categories_parent_owner_kind_fk';

const columns = {
  id: categories.id,
  kind: categories.kind,
  parentId: categories.parentId,
  defaultKey: categories.defaultKey,
  name: categories.name,
  icon: categories.icon,
  color: categories.color,
  archivedAt: categories.archivedAt,
  createdAt: categories.createdAt,
};

const inScope = (scope: AccessScope) => scopedTo(scope, { owner: categories.ownerId });

/** This row, and only if the scope covers it, in the same statement. */
const scopedRow = (scope: AccessScope, id: string) => and(eq(categories.id, id), inScope(scope));

/** A unique violation on the custom-name index is the second line of defence of the name rule. */
function asNameTaken(error: unknown): unknown {
  return violatedConstraint(error, '23505') === NAME_UNIQUE_CONSTRAINT
    ? new CategoryNameTaken()
    : error;
}

/** The parent vanished between the check and the insert: the same 404 as a missing parent. */
function asMissingParent(error: unknown): unknown {
  return violatedConstraint(error, '23503') === PARENT_FOREIGN_KEY
    ? new ResourceNotFound()
    : asNameTaken(error);
}

/** Atomic primitives on one transaction, every statement scoped to the caller. */
class TransactionView implements CategoryTransaction {
  constructor(
    private readonly tx: SeedDatabase,
    private readonly scope: AccessScope<'write'>,
  ) {}

  async findById(id: string): Promise<Category | null> {
    const [row] = await this.tx
      .select(columns)
      .from(categories)
      .where(scopedRow(this.scope, id))
      .limit(1);
    return row ?? null;
  }

  listSiblings(kind: CategoryKind, parentId: string | null): Promise<Category[]> {
    return this.tx
      .select(columns)
      .from(categories)
      .where(
        and(
          inScope(this.scope),
          eq(categories.kind, kind),
          parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId),
        ),
      )
      .orderBy(asc(categories.createdAt), asc(categories.id));
  }

  async insert(data: InsertCategoryData): Promise<Category> {
    try {
      const [row] = await this.tx
        .insert(categories)
        .values({ ...data, ownerId: this.scope.userId })
        .returning(columns);
      if (!row) throw new Error('Inserting a category returned no row');
      return row;
    } catch (error) {
      throw asMissingParent(error);
    }
  }

  async updateFields(id: string, fields: UpdateCategoryFields): Promise<Category | null> {
    try {
      const [row] = await this.tx
        .update(categories)
        .set({ ...fields, updatedAt: sql`now()` })
        .where(scopedRow(this.scope, id))
        .returning(columns);
      return row ?? null;
    } catch (error) {
      throw asNameTaken(error);
    }
  }
}

export class DrizzleCategoryRepository implements CategoryRepository {
  constructor(private readonly db: Database) {}

  async ensureDefaults(scope: AccessScope<'write'>): Promise<void> {
    const [marker] = await this.db
      .select({ ownerId: categoryDefaultsSeeded.ownerId })
      .from(categoryDefaultsSeeded)
      .where(scopedTo(scope, { owner: categoryDefaultsSeeded.ownerId }))
      .limit(1);
    if (marker) return;
    // The same single statement the account-creation hook runs; it re-checks the marker itself.
    await seedDefaultCategories(this.db, scope.userId);
  }

  async findById(scope: AccessScope, id: string): Promise<Category | null> {
    const [row] = await this.db
      .select(columns)
      .from(categories)
      .where(scopedRow(scope, id))
      .limit(1);
    return row ?? null;
  }

  async list(
    scope: AccessScope,
    options: ListCategoriesOptions,
  ): Promise<{ items: Category[]; total: number }> {
    const filters: (SQL | undefined)[] = [
      inScope(scope),
      options.archived ? isNotNull(categories.archivedAt) : isNull(categories.archivedAt),
      options.kind === undefined ? undefined : eq(categories.kind, options.kind),
    ];
    const where = and(...filters);
    const items = await this.db
      .select(columns)
      .from(categories)
      .where(where)
      .orderBy(asc(categories.createdAt), asc(categories.id))
      .limit(options.limit)
      .offset(options.offset);
    const [totalRow] = await this.db.select({ total: count() }).from(categories).where(where);
    return { items, total: totalRow?.total ?? 0 };
  }

  async setArchived(
    scope: AccessScope<'write'>,
    id: string,
    archived: boolean,
  ): Promise<Category | null> {
    // The database clock stamps both columns. One statement, idempotent: a row already in the
    // target state keeps archived_at and updated_at, and is still returned.
    const now = sql`now()`;
    if (archived) {
      // The target and its subcategories; a subcategory archived earlier keeps its archived_at.
      const rows = await this.db
        .update(categories)
        .set({
          archivedAt: sql<Date>`coalesce(${categories.archivedAt}, ${now})`,
          updatedAt: sql<Date>`case when ${categories.archivedAt} is null then ${now} else ${categories.updatedAt} end`,
        })
        .where(and(or(eq(categories.id, id), eq(categories.parentId, id)), inScope(scope)))
        .returning(columns);
      return rows.find((row) => row.id === id) ?? null;
    }
    const [row] = await this.db
      .update(categories)
      .set({
        archivedAt: sql<null>`null`,
        updatedAt: sql<Date>`case when ${categories.archivedAt} is not null then ${now} else ${categories.updatedAt} end`,
      })
      .where(scopedRow(scope, id))
      .returning(columns);
    return row ?? null;
  }

  async countChildren(scope: AccessScope, id: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(categories)
      .where(and(eq(categories.parentId, id), inScope(scope)));
    return row?.total ?? 0;
  }

  async delete(scope: AccessScope<'write'>, id: string): Promise<boolean> {
    try {
      const rows = await this.db
        .delete(categories)
        .where(scopedRow(scope, id))
        .returning({ id: categories.id });
      return rows.length === 1;
    } catch (error) {
      // The budgets category key is DEFERRABLE INITIALLY DEFERRED, so its violation surfaces here
      // (end of this autocommit statement) only because the delete is not wrapped in a larger
      // transaction; a caller that does wrap it would see the error at COMMIT instead.
      throw violatedConstraint(error, '23503') === undefined ? error : new CategoryInUse();
    }
  }

  /**
   * Transaction-scoped advisory lock keyed by owner: released at commit or rollback. It serializes
   * the name checks of one owner; a hash collision only serializes two unrelated owners.
   */
  runExclusive<T>(
    scope: AccessScope<'write'>,
    fn: (tx: CategoryTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`categories:name:${scope.userId}`}, 0))`,
      );
      return fn(new TransactionView(tx, scope));
    });
  }
}
