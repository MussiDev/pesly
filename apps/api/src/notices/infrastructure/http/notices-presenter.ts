import type { ListNoticesResponse, Notice as NoticeResponse } from '@pesly/shared';
import type { Notice } from '../../domain/notice';

/** Explicit field list: nothing else a row might carry (owner, payment id) can reach the response. */
export function presentNotice(notice: Notice): NoticeResponse {
  return {
    id: notice.id,
    kind: notice.kind,
    text: notice.text,
    dueDate: notice.dueDate,
    createdAt: notice.createdAt,
    readAt: notice.readAt,
  };
}

export function presentNoticePage(page: ListNoticesResponse): ListNoticesResponse {
  return {
    items: page.items.map(presentNotice),
    nextCursor: page.nextCursor,
    unreadCount: page.unreadCount,
  };
}
