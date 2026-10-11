import {
  countGroupQueue,
  withGroupQueue,
  type GroupQueueCounts,
} from '@/lib/local-store/group-queue';

const EMPTY: GroupQueueCounts = { pending: 0, failed: 0, conflict: 0 };

/**
 * What waits on this device for group records, with conflicts apart from failures (FR-04). Like the
 * movement counts, a queue that cannot be read counts as empty.
 */
export async function readGroupQueueCounts(userId: string | undefined): Promise<GroupQueueCounts> {
  if (userId === undefined) return EMPTY;
  try {
    return await withGroupQueue(userId, countGroupQueue);
  } catch {
    return EMPTY;
  }
}
