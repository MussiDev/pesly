import { and, eq } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import type { StatementImportRepository } from '../../application/ports/statement-import-repository';
import { cardStatementImportLines } from './schema';

export class DrizzleStatementImportRepository implements StatementImportRepository {
  constructor(private readonly db: Database) {}

  async claim(scope: AccessScope<'write'>, cardId: string, fingerprint: string): Promise<boolean> {
    const rows = await this.db
      .insert(cardStatementImportLines)
      .values({ ownerId: scope.userId, cardId, fingerprint })
      .onConflictDoNothing()
      .returning({ fingerprint: cardStatementImportLines.fingerprint });
    return rows.length === 1;
  }

  async release(scope: AccessScope<'write'>, cardId: string, fingerprint: string): Promise<void> {
    await this.db
      .delete(cardStatementImportLines)
      .where(
        and(
          eq(cardStatementImportLines.ownerId, scope.userId),
          eq(cardStatementImportLines.cardId, cardId),
          eq(cardStatementImportLines.fingerprint, fingerprint),
        ),
      );
  }
}
