import { and, eq } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type { DebitAccountInfo, DebitAccounts } from '../../application/ports/debit-accounts';
import { accounts } from './foreign-relations';

export class DrizzleDebitAccounts implements DebitAccounts {
  constructor(private readonly db: Database) {}

  async find(scope: AccessScope, accountId: string): Promise<DebitAccountInfo | null> {
    const [row] = await this.db
      .select({ currency: accounts.currency, archivedAt: accounts.archivedAt })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), scopedTo(scope, { owner: accounts.ownerId })))
      .limit(1);
    if (!row) return null;
    return { currency: row.currency, archived: row.archivedAt !== null };
  }
}
