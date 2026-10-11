import type { ExpenseSnapshot, SettlementSnapshot } from '@pesly/shared';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import type {
  ActivityLogEntry,
  ActivityLogReader,
  ActivityPageResult,
  ListActivityPageQuery,
} from '../../application/ports/activity-log-reader';
import { decodeCursor, pageOf, type Cursor } from './keyset-cursor';
import { groupActivityLog } from './schema';

/** Rows strictly after the cursor in `(created_at desc, id desc)` order. */
function afterCursor(cursor: Cursor | null): SQL | undefined {
  return cursor === null
    ? undefined
    : sql`(${groupActivityLog.createdAt}, ${groupActivityLog.id}) < (${cursor.occurredAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`;
}

function subjectTypeOf(action: string): ActivityLogEntry['subjectType'] {
  return action.startsWith('settlement_') ? 'settlement' : 'expense';
}

export class DrizzleActivityLogReader implements ActivityLogReader {
  constructor(private readonly db: Database) {}

  async list(groupId: string, query: ListActivityPageQuery): Promise<ActivityPageResult> {
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
    const rows = await this.db
      .select({
        id: groupActivityLog.id,
        groupId: groupActivityLog.groupId,
        action: groupActivityLog.action,
        subjectId: groupActivityLog.subjectId,
        memberId: groupActivityLog.memberId,
        createdAt: groupActivityLog.createdAt,
        before: groupActivityLog.before,
        after: groupActivityLog.after,
      })
      .from(groupActivityLog)
      .where(and(eq(groupActivityLog.groupId, groupId), afterCursor(cursor)))
      .orderBy(desc(groupActivityLog.createdAt), desc(groupActivityLog.id))
      .limit(query.limit + 1);
    // The keyset helpers speak of `occurredAt`; here the sort instant is `createdAt`.
    const page = pageOf(
      rows.map((row) => ({ ...row, occurredAt: row.createdAt })),
      query.limit,
    );
    return {
      items: page.items.map((row) => ({
        id: row.id,
        groupId: row.groupId,
        action: row.action,
        subjectType: subjectTypeOf(row.action),
        subjectId: row.subjectId,
        memberId: row.memberId,
        createdAt: row.createdAt,
        // The snapshots are written only by the change use cases, in the shape of the contract.
        before: row.before as ExpenseSnapshot | SettlementSnapshot | null,
        after: row.after as ExpenseSnapshot | SettlementSnapshot | null,
      })),
      nextCursor: page.nextCursor,
    };
  }
}
