import type { NoticeCursor } from '@pesly/shared';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type { NoticeRepository } from '../../application/ports/notice-repository';
import type { Notice } from '../../domain/notice';
import { notices } from './schema';

// Microsecond-exact ISO text: a millisecond Date would round the keyset cursor and skip rows.
const isoOf = (column: typeof notices.createdAt | typeof notices.readAt) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const noticeColumns = {
  id: notices.id,
  kind: notices.kind,
  text: notices.text,
  dueDate: notices.dueDate,
  createdAt: isoOf(notices.createdAt),
  readAt: sql<
    string | null
  >`case when ${notices.readAt} is null then null else ${isoOf(notices.readAt)} end`,
};

const ownNotices = (scope: AccessScope) => scopedTo(scope, { owner: notices.ownerId });

export class DrizzleNoticeRepository implements NoticeRepository {
  constructor(private readonly db: Database) {}

  list(
    scope: AccessScope,
    options: { limit: number; cursor: NoticeCursor | null },
  ): Promise<Notice[]> {
    const { cursor } = options;
    const after = cursor
      ? sql`(${notices.createdAt}, ${notices.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
      : undefined;
    return this.db
      .select(noticeColumns)
      .from(notices)
      .where(and(ownNotices(scope), after))
      .orderBy(desc(notices.createdAt), desc(notices.id))
      .limit(options.limit);
  }

  async unreadCount(scope: AccessScope): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(notices)
      .where(and(ownNotices(scope), isNull(notices.readAt)));
    return row?.total ?? 0;
  }

  async markRead(scope: AccessScope<'write'>, id: string): Promise<Notice | null> {
    const [row] = await this.db
      .update(notices)
      .set({ readAt: sql`coalesce(${notices.readAt}, now())` })
      .where(and(eq(notices.id, id), ownNotices(scope)))
      .returning(noticeColumns);
    return row ?? null;
  }

  async markAllRead(scope: AccessScope<'write'>): Promise<number> {
    const rows = await this.db
      .update(notices)
      .set({ readAt: sql`now()` })
      .where(and(ownNotices(scope), isNull(notices.readAt)))
      .returning({ id: notices.id });
    return rows.length;
  }
}
