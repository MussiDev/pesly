import type { ActivityEntry, ActivityPage } from '@pesly/shared';
import type {
  ActivityLogEntry,
  ActivityPageResult,
} from '../../application/ports/activity-log-reader';

/**
 * Snapshots are stored with string amounts and ISO dates (spec D7), so only the entry's own
 * instant needs converting; the group id stays out of the response, the caller already knows it.
 */
export function presentActivityEntry(entry: ActivityLogEntry): ActivityEntry {
  return {
    id: entry.id,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    memberId: entry.memberId,
    createdAt: entry.createdAt.toISOString(),
    before: entry.before,
    after: entry.after,
  };
}

export function presentActivityPage(page: ActivityPageResult): ActivityPage {
  return { items: page.items.map(presentActivityEntry), nextCursor: page.nextCursor };
}
