import { isIanaTimeZone } from '@pesly/shared';
import { eq } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import type { UserTimeZone } from '../../application/ports/user-time-zone';
import { users } from './foreign-relations';

const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export class DrizzleUserTimeZone implements UserTimeZone {
  constructor(private readonly db: Database) {}

  /** The caller's own row by primary key. A missing user fails closed: no zone is guessed. */
  async timeZoneOf(userId: string): Promise<string> {
    const [row] = await this.db
      .select({ timeZone: users.timeZone })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new Error('Time zone requested for a user that does not exist');
    return isIanaTimeZone(row.timeZone) ? row.timeZone : DEFAULT_TIME_ZONE;
  }
}
