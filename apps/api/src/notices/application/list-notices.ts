import {
  decodeNoticeCursor,
  encodeNoticeCursor,
  NOTICE_LIST_MAX_LIMIT,
  type ListNoticesResponse,
} from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { NoticeRepository } from './ports/notice-repository';

export class ListNotices {
  constructor(private readonly notices: NoticeRepository) {}

  async execute(
    scope: AccessScope,
    query: { limit: number; cursor?: string },
  ): Promise<ListNoticesResponse> {
    const limit = Math.min(Math.max(query.limit, 1), NOTICE_LIST_MAX_LIMIT);
    const cursor = query.cursor === undefined ? null : decodeNoticeCursor(query.cursor);
    const [rows, unreadCount] = await Promise.all([
      this.notices.list(scope, { limit: limit + 1, cursor }),
      this.notices.unreadCount(scope),
    ]);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor =
      rows.length > limit && last
        ? encodeNoticeCursor({ createdAt: last.createdAt, id: last.id })
        : null;
    return { items, nextCursor, unreadCount };
  }
}
