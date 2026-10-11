import type {
  ActivityLogEntry,
  ActivityLogReader,
  ActivityPageResult,
  ListActivityPageQuery,
} from '../../src/groups';
import type { ActivityRow, InMemoryGroupExpenseRepository } from './expense-fakes';

function subjectTypeOf(row: ActivityRow): 'expense' | 'settlement' {
  return row.action.startsWith('expense_') ? 'expense' : 'settlement';
}

function newestFirst(a: ActivityRow, b: ActivityRow): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : -1;
}

function afterCursor(row: ActivityRow, cursor: string | undefined): boolean {
  if (cursor === undefined) return true;
  const [at, id] = cursor.split('|');
  const time = new Date(at ?? '').getTime();
  if (row.createdAt.getTime() !== time) return row.createdAt.getTime() < time;
  return row.id < (id ?? '');
}

/** Reads the log rows the fakes write (they live in the expense fake, shared by both). */
export class InMemoryActivityLogReader implements ActivityLogReader {
  constructor(private readonly expenses: InMemoryGroupExpenseRepository) {}

  async list(groupId: string, query: ListActivityPageQuery): Promise<ActivityPageResult> {
    await Promise.resolve();
    const all = this.expenses.activity
      .filter((row) => row.groupId === groupId)
      .sort(newestFirst)
      .filter((row) => afterCursor(row, query.cursor));
    const page = all.slice(0, query.limit);
    const last = page[page.length - 1];
    const items: ActivityLogEntry[] = page.map((row) => ({
      id: row.id,
      groupId: row.groupId,
      action: row.action,
      subjectType: subjectTypeOf(row),
      subjectId: row.subjectId,
      memberId: row.memberId,
      createdAt: row.createdAt,
      before: row.before,
      after: row.after,
    }));
    const nextCursor =
      all.length > query.limit && last !== undefined
        ? `${last.createdAt.toISOString()}|${last.id}`
        : null;
    return { items, nextCursor };
  }
}
