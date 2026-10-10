import { eq, or } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import { creditCards } from './schema';

/**
 * Implements the accounts module's `AccountLinks` port (spec D2, D10).
 *
 * UNSCOPED BY DESIGN: it takes no `AccessScope`. The accounts module passes it only an id its
 * scoped repository just returned, and it answers a boolean about that id alone.
 */
export class DrizzleCardAccountLinks {
  constructor(private readonly db: Database) {}

  async isLinked(accountId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: creditCards.id })
      .from(creditCards)
      .where(or(eq(creditCards.arsAccountId, accountId), eq(creditCards.usdAccountId, accountId)))
      .limit(1);
    return row !== undefined;
  }
}
