import { and, eq, sql } from 'drizzle-orm';
import type { AccountLookup, AccountReference } from '../../application/ports/account-lookup';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import { accounts } from './foreign-relations';

export class DrizzleAccountLookup implements AccountLookup {
  constructor(private readonly db: Database) {}

  /** Id, archived state and currency, filtered by the scope in the same statement. */
  async find(scope: AccessScope, id: string): Promise<AccountReference | null> {
    const [row] = await this.db
      .select({
        id: accounts.id,
        archived: sql<boolean>`${accounts.archivedAt} is not null`,
        currency: accounts.currency,
      })
      .from(accounts)
      .where(and(eq(accounts.id, id), scopedTo(scope, { owner: accounts.ownerId })))
      .limit(1);
    return row ?? null;
  }
}
