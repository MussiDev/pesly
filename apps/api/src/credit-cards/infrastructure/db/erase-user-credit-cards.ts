import { eq } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { creditCards, installmentPurchases } from './schema';

/**
 * A database handle or a transaction on it, declared structurally so the erasure transaction of
 * identity can be passed in without credit-cards importing identity internals.
 */
export type EraseDatabase = PgDatabase<NodePgQueryResultHKT>;

/**
 * Deletes the user's installment purchases (their installments go by cascade) and then their
 * cards; their statements go by cascade. The keys from purchases to cards and categories restrict. The keys from cards to the linked
 * accounts restrict, so the cards must go before the user's accounts do (the cascade from `users`
 * does not guarantee an order). Registered by the composition root as an ordered erasure step.
 */
export async function eraseUserCreditCards(tx: EraseDatabase, userId: string): Promise<void> {
  await tx.delete(installmentPurchases).where(eq(installmentPurchases.ownerId, userId));
  await tx.delete(creditCards).where(eq(creditCards.ownerId, userId));
}
