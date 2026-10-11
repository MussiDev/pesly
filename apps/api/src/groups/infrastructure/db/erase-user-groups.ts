import { eq } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { groupMembers } from './schema';

/**
 * A database handle or a transaction on it, declared structurally so the erasure transaction of
 * identity can be passed in without groups importing identity internals.
 */
export type EraseDatabase = PgDatabase<NodePgQueryResultHKT>;

export const FORMER_MEMBER_NAME = 'Former member';

/**
 * Turns every membership of the user into a ghost named "Former member" with the role `member`,
 * keeping the member row so the group stays intact (spec D10). The key from members to users
 * restricts, so this must run before the `users` row is deleted. One statement: the checks of the
 * table hold for the whole row at once. Registered by the composition root as an erasure step.
 */
export async function eraseUserGroups(tx: EraseDatabase, userId: string): Promise<void> {
  await tx
    .update(groupMembers)
    .set({ userId: null, displayName: FORMER_MEMBER_NAME, role: 'member' })
    .where(eq(groupMembers.userId, userId));
}
