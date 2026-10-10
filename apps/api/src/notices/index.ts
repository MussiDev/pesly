import type { NoticePublisher } from '../recurring/application/ports/notice-publisher';
import type { Database } from '../shared/db/client';
import { DrizzleNoticePublisher } from './infrastructure/db/drizzle-notice-publisher';

export { createNoticesRoutes } from './infrastructure/http/notices-routes';

/**
 * The system-side publisher used by the recurring jobs. It is deliberately separate from the
 * routes: no HTTP request can reach it.
 */
export function createNoticePublisher(db: Database): NoticePublisher {
  return new DrizzleNoticePublisher(db);
}
