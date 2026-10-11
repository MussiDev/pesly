import type { StatementReminderPublisher } from '../credit-cards/application/ports/statement-reminder-publisher';
import type { NoticePublisher } from '../recurring/application/ports/notice-publisher';
import type { Database } from '../shared/db/client';
import { DrizzleNoticePublisher } from './infrastructure/db/drizzle-notice-publisher';
import { DrizzleStatementReminderPublisher } from './infrastructure/db/drizzle-statement-reminder-publisher';

export { createNoticesRoutes } from './infrastructure/http/notices-routes';

/**
 * The system-side publisher used by the recurring jobs. It is deliberately separate from the
 * routes: no HTTP request can reach it.
 */
export function createNoticePublisher(db: Database): NoticePublisher {
  return new DrizzleNoticePublisher(db);
}

/** The system-side publisher of the credit card statement reminders (DISC-001-10f); worker only. */
export function createStatementReminderPublisher(db: Database): StatementReminderPublisher {
  return new DrizzleStatementReminderPublisher(db);
}
