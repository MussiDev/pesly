import { and, inArray } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type { BudgetCategoryRef, CategoryReader } from '../../application/ports/category-reader';
import { categories } from './foreign-relations';

export class DrizzleCategoryReader implements CategoryReader {
  constructor(private readonly db: Database) {}

  async findMany(scope: AccessScope, ids: readonly string[]): Promise<BudgetCategoryRef[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: categories.id, kind: categories.kind, archivedAt: categories.archivedAt })
      .from(categories)
      .where(and(inArray(categories.id, [...ids]), scopedTo(scope, { owner: categories.ownerId })));
    return rows.map((row) => ({ id: row.id, kind: row.kind, archived: row.archivedAt !== null }));
  }
}
