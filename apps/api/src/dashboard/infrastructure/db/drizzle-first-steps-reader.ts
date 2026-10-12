import { and, isNull, sql } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type { FirstStepsFacts, FirstStepsReader } from '../../application/ports/first-steps-reader';
import { accounts, movements } from './foreign-relations';

export class DrizzleFirstStepsReader implements FirstStepsReader {
  constructor(private readonly db: Database) {}

  async firstStepsOf(scope: AccessScope): Promise<FirstStepsFacts> {
    // One statement, two probes; both are served by the owner indexes.
    const result = await this.db.execute<{ has_account: boolean; has_movement: boolean }>(sql`
      select
        exists (
          select 1 from ${accounts}
          where ${and(scopedTo(scope, { owner: accounts.ownerId }), isNull(accounts.archivedAt))}
        ) as has_account,
        exists (
          select 1 from ${movements}
          where ${scopedTo(scope, { owner: movements.ownerId })}
        ) as has_movement
    `);
    const row = result.rows[0];
    return { hasAccount: row?.has_account === true, hasMovement: row?.has_movement === true };
  }
}
