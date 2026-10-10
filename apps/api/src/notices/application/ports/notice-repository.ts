import type { NoticeCursor } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';
import type { Notice } from '../../domain/notice';

export interface NoticeRepository {
  /** Newest first by (created_at, id); `limit` rows after `cursor` (exclusive). */
  list(
    scope: AccessScope,
    options: { limit: number; cursor: NoticeCursor | null },
  ): Promise<Notice[]>;
  unreadCount(scope: AccessScope): Promise<number>;
  /** Sets `read_at` once (the first read wins); `null` when the id is not the caller's. */
  markRead(scope: AccessScope<'write'>, id: string): Promise<Notice | null>;
  /** Returns how many notices changed from unread to read. */
  markAllRead(scope: AccessScope<'write'>): Promise<number>;
}
