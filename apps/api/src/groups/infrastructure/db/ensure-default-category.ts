import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { DEFAULT_CATEGORIES } from '@pesly/shared';
import type { Database } from '../../../shared/db/client';
import { groupCategories } from './schema';

/** The transaction handle drizzle passes to the callback of `Database.transaction`. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type DefaultCategoryChange = 'created' | 'restored' | null;

export interface EnsuredDefaultCategory {
  categoryId: string;
  change: DefaultCategoryChange;
}

async function findRow(tx: Tx, groupId: string, key: string) {
  const [row] = await tx
    .select({ id: groupCategories.id, archivedAt: groupCategories.archivedAt })
    .from(groupCategories)
    .where(and(eq(groupCategories.groupId, groupId), eq(groupCategories.defaultKey, key)));
  return row;
}

/** `null` when another transaction restored the row first. */
async function restore(tx: Tx, id: string): Promise<DefaultCategoryChange> {
  const restored = await tx
    .update(groupCategories)
    .set({ archivedAt: null, updatedAt: sql`now()` })
    .where(and(eq(groupCategories.id, id), isNotNull(groupCategories.archivedAt)))
    .returning({ id: groupCategories.id });
  return restored.length > 0 ? 'restored' : null;
}

/**
 * The group's active category equivalent to a personal one: the root of the personal default key
 * (`food.groceries` -> `food`). Read-only: it never creates or restores anything, so an archived or
 * missing equivalent, or a custom personal category, answers null (spec 05i D18).
 */
export async function findEquivalentCategory(
  tx: Tx,
  groupId: string,
  personalDefaultKey: string | null,
): Promise<string | null> {
  if (personalDefaultKey === null) return null;
  const rootKey = personalDefaultKey.split('.')[0] ?? '';
  const row = await findRow(tx, groupId, rootKey);
  return row !== undefined && row.archivedAt === null ? row.id : null;
}

/**
 * Returns the group's category of a top-level expense default, creating it or restoring it when
 * needed, inside the caller's transaction. It takes no request value, so a caller cannot steer
 * it; the unique index on (group_id, default_key) is the race backstop.
 */
export async function ensureDefaultCategory(
  tx: Tx,
  groupId: string,
  key: string,
): Promise<EnsuredDefaultCategory> {
  const entry = DEFAULT_CATEGORIES.find(
    (candidate) =>
      candidate.key === key && candidate.parentKey === null && candidate.kind === 'expense',
  );
  if (entry === undefined) {
    throw new Error(`Not a top-level expense default category key: ${key}`);
  }

  let row = await findRow(tx, groupId, key);
  if (row === undefined) {
    const inserted = await tx
      .insert(groupCategories)
      .values({ groupId, defaultKey: key, name: null, icon: entry.icon, color: entry.color })
      .onConflictDoNothing({
        target: [groupCategories.groupId, groupCategories.defaultKey],
        where: isNotNull(groupCategories.defaultKey),
      })
      .returning({ id: groupCategories.id });
    const insertedRow = inserted[0];
    if (insertedRow !== undefined) {
      return { categoryId: insertedRow.id, change: 'created' };
    }
    // A concurrent send inserted it; its commit is visible now.
    row = await findRow(tx, groupId, key);
    if (row === undefined) {
      throw new Error('The default category vanished after a conflicting insert');
    }
  }

  if (row.archivedAt !== null) {
    return { categoryId: row.id, change: await restore(tx, row.id) };
  }
  return { categoryId: row.id, change: null };
}
