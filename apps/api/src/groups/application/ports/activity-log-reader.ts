import type { ExpenseSnapshot, GroupActivityAction, SettlementSnapshot } from '@pesly/shared';

/** One log row (spec D9): creations carry no snapshots, a deletion carries no `after`. */
export interface ActivityLogEntry {
  id: string;
  groupId: string;
  action: GroupActivityAction;
  subjectType: 'expense' | 'settlement';
  subjectId: string;
  memberId: string;
  createdAt: Date;
  before: ExpenseSnapshot | SettlementSnapshot | null;
  after: ExpenseSnapshot | SettlementSnapshot | null;
}

export interface ListActivityPageQuery {
  limit: number;
  /** Opaque; produced by a previous page. */
  cursor?: string;
}

export interface ActivityPageResult {
  items: ActivityLogEntry[];
  nextCursor: string | null;
}

/** Read-only and scoped by group id; the use case checks membership first. */
export interface ActivityLogReader {
  /** Newest first (`created_at desc, id desc`), keyset pages. */
  list(groupId: string, query: ListActivityPageQuery): Promise<ActivityPageResult>;
}
