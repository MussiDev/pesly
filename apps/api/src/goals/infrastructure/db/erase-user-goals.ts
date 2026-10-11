import { eq } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { goals } from './schema';

/**
 * A database handle or a transaction on it, declared structurally so the erasure transaction of
 * identity can be passed in without goals importing identity internals.
 */
export type EraseDatabase = PgDatabase<NodePgQueryResultHKT>;

/**
 * Deletes the user's goals; their entries go by cascade. The key from a goal to its linked
 * account restricts, so the goals must go before the accounts do (the cascade from `users` does
 * not guarantee an order). Registered by the composition root as an ordered erasure step.
 */
export async function eraseUserGoals(tx: EraseDatabase, userId: string): Promise<void> {
  await tx.delete(goals).where(eq(goals.ownerId, userId));
}
