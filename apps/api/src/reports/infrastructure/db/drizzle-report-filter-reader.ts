import { and, eq, sql } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type { ReportFilterReader } from '../../application/ports/report-filter-reader';
import { accounts, tags } from './foreign-relations';

export class DrizzleReportFilterReader implements ReportFilterReader {
  constructor(private readonly db: Database) {}

  async ownsAccount(scope: AccessScope, accountId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), scopedTo(scope, { owner: accounts.ownerId })))
      .limit(1);
    return rows.length > 0;
  }

  async ownsTag(scope: AccessScope, name: string): Promise<boolean> {
    // Equality on lower(): the unique (owner_id, lower(name)) index serves it, and no LIKE is used.
    const rows = await this.db
      .select({ id: tags.id })
      .from(tags)
      .where(
        and(scopedTo(scope, { owner: tags.ownerId }), sql`lower(${tags.name}) = lower(${name})`),
      )
      .limit(1);
    return rows.length > 0;
  }
}
