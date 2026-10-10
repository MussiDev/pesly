import type { NoticeKind } from '@pesly/shared';

export type { NoticeKind };

/** A notice as the owner sees it. Timestamps are ISO strings with microsecond precision. */
export interface Notice {
  id: string;
  kind: NoticeKind;
  text: string;
  dueDate: string;
  createdAt: string;
  readAt: string | null;
}

/** A notice to store; the text is already rendered. */
export interface NewNotice {
  ownerId: string;
  kind: NoticeKind;
  paymentId: string;
  dueDate: string;
  text: string;
}
