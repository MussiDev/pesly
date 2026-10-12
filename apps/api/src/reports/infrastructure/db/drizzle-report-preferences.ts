import { isIanaTimeZone } from '@pesly/shared';
import { eq } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import type {
  ReportPreferences,
  ReportPreferencesReader,
} from '../../application/ports/report-preferences';
import { users } from './foreign-relations';

const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export class DrizzleReportPreferences implements ReportPreferencesReader {
  constructor(private readonly db: Database) {}

  async preferencesOf(userId: string): Promise<ReportPreferences> {
    const [row] = await this.db
      .select({
        displayCurrency: users.displayCurrency,
        defaultRateType: users.defaultRateType,
        timeZone: users.timeZone,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new Error('Report preferences requested for a user that does not exist');
    return {
      displayCurrency: row.displayCurrency,
      defaultRateType: row.defaultRateType,
      timeZone: isIanaTimeZone(row.timeZone) ? row.timeZone : DEFAULT_TIME_ZONE,
    };
  }
}
