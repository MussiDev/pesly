import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import { groupMembers, groups } from './schema';

/** The transaction handle drizzle passes to the callback of `Database.transaction`. */
export type GroupTx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Locks the group row. Settlements take `update` so a consolidated one reads the balances with no
 * expense in flight; expenses take `share`, so expenses run together but never beside a settlement
 * (spec D10). Always taken before any member row, so the order is the same on every path.
 */
export async function lockGroup(
  tx: GroupTx,
  groupId: string,
  mode: 'update' | 'share',
): Promise<void> {
  await tx.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).for(mode);
}

/**
 * Re-reads the members `for share` (rows ordered by id so concurrent writers lock them in the same
 * order) and says whether every one is an active member of the group (`left_at is null`). A
 * member of another group, a missing one and one who left all answer false (spec D10).
 */
export async function allActiveMembers(
  tx: GroupTx,
  groupId: string,
  memberIds: readonly string[],
): Promise<boolean> {
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return true;
  const rows = await tx
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        inArray(groupMembers.id, unique),
        isNull(groupMembers.leftAt),
      ),
    )
    .orderBy(groupMembers.id)
    .for('share');
  return rows.length === unique.length;
}
