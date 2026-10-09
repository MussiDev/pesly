import { eq } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { recurringPayments } from './schema';

/**
 * A database handle or a transaction on it, declared structurally so the erasure transaction of
 * identity can be passed in without recurring importing identity internals.
 */
export type EraseDatabase = PgDatabase<NodePgQueryResultHKT>;

/**
 * Deletes the user's recurring payments; their occurrences go by cascade. The keys from payments
 * to the user's accounts and categories restrict, so the payments must go before those do (the
 * cascade from `users` does not guarantee an order). Registered by the composition root as an
 * ordered erasure step.
 */
export async function eraseUserRecurring(tx: EraseDatabase, userId: string): Promise<void> {
  await tx.delete(recurringPayments).where(eq(recurringPayments.ownerId, userId));
}
