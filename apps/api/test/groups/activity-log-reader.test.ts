import { AppError } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settlementSnapshot, type ActivityLogEntry } from '../../src/groups';
import { DrizzleActivityLogReader } from '../../src/groups/infrastructure/db/drizzle-activity-log-reader';
import { DrizzleGroupSettlementRepository } from '../../src/groups/infrastructure/db/drizzle-group-settlement-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { HOUR, newDbWorld, NOW, plainSettlement, type DbWorld } from './settlement-db-world';

let connection: DatabaseConnection;
let reader: DrizzleActivityLogReader;
let settlements: DrizzleGroupSettlementRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  reader = new DrizzleActivityLogReader(connection.db);
  settlements = new DrizzleGroupSettlementRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

function world(): Promise<DbWorld> {
  return newDbWorld(connection.db, connection.pool, { ghosts: 1 });
}

async function readAll(groupId: string, limit: number): Promise<ActivityLogEntry[]> {
  const seen: ActivityLogEntry[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await reader.list(groupId, { limit, ...(cursor === undefined ? {} : { cursor }) });
    seen.push(...page.items);
    if (page.nextCursor === null) return seen;
    cursor = page.nextCursor;
  }
  throw new Error('The reader did not end');
}

describe('DrizzleActivityLogReader', () => {
  it('returns each entry once across pages, newest first, with ties broken by id descending', async () => {
    const w = await world();
    // Twelve rows share one instant so the id tie-break is what the pages are cut on.
    await connection.pool.query(
      `insert into group_activity_log (group_id, member_id, action, subject_id, created_at)
       select $1, $2, 'expense_created', gen_random_uuid(), $3::timestamptz from generate_series(1, 12)`,
      [w.groupId, w.anaMember, NOW.toISOString()],
    );
    await connection.pool.query(
      `insert into group_activity_log (group_id, member_id, action, subject_id, created_at)
       select $1, $2, 'settlement_created', gen_random_uuid(), $3::timestamptz + (g || ' minutes')::interval
       from generate_series(1, 5) g`,
      [w.groupId, w.anaMember, NOW.toISOString()],
    );

    const entries = await readAll(w.groupId, 4);
    const expected = await connection.pool.query<{ id: string }>(
      'select id from group_activity_log where group_id = $1 order by created_at desc, id desc',
      [w.groupId],
    );

    expect(entries.map((entry) => entry.id)).toEqual(expected.rows.map((row) => row.id));
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(17);
    expect(entries.slice(0, 5).every((entry) => entry.action === 'settlement_created')).toBe(true);
    expect(entries[0]?.groupId).toBe(w.groupId);
  });

  it('derives the subject type from the action and carries before and after as stored', async () => {
    const w = await world();
    const saved = await settlements.saveSettlement(plainSettlement(w));
    await settlements.deleteSettlement({
      groupId: w.groupId,
      settlementId: saved.id,
      activity: {
        action: 'settlement_deleted',
        memberId: w.anaMember,
        createdAt: new Date(NOW.getTime() + HOUR),
        before: settlementSnapshot(saved),
        after: null,
      },
    });
    await connection.pool.query(
      `insert into group_activity_log (group_id, member_id, action, subject_id, created_at)
       values ($1, $2, 'expense_created', gen_random_uuid(), $3)`,
      [w.groupId, w.anaMember, new Date(NOW.getTime() - HOUR).toISOString()],
    );

    const { items, nextCursor } = await reader.list(w.groupId, { limit: 10 });

    expect(nextCursor).toBeNull();
    expect(items.map((entry) => [entry.action, entry.subjectType])).toEqual([
      ['settlement_deleted', 'settlement'],
      ['settlement_created', 'settlement'],
      ['expense_created', 'expense'],
    ]);
    // The log of a deleted record stays readable (AC-10).
    expect(items[0]?.subjectId).toBe(saved.id);
    expect(items[0]?.before).toEqual(settlementSnapshot(saved));
    expect(items[0]?.after).toBeNull();
    expect(items[1]?.before).toBeNull();
    expect(items[0]?.createdAt).toEqual(new Date(NOW.getTime() + HOUR));
  });

  it('returns nothing of another group', async () => {
    const w = await world();
    const other = await world();
    await settlements.saveSettlement(plainSettlement(other));
    await settlements.saveSettlement(plainSettlement(other));
    await settlements.saveSettlement(plainSettlement(w));

    const mine = await readAll(w.groupId, 1);
    const empty = await world();

    expect(mine).toHaveLength(1);
    expect(mine.every((entry) => entry.groupId === w.groupId)).toBe(true);
    expect((await reader.list(empty.groupId, { limit: 5 })).items).toEqual([]);
  });

  it('answers an invalid cursor error as a 400 validation error', async () => {
    const w = await world();

    const failure: unknown = await reader
      .list(w.groupId, { limit: 5, cursor: 'not a cursor!' })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AppError);
    expect((failure as AppError).code).toBe('VALIDATION_FAILED');
  });
});

describe('the log is immutable', () => {
  it('fails a direct update or delete of a log row with the trigger error (AC-11)', async () => {
    const w = await world();
    const saved = await settlements.saveSettlement(plainSettlement(w));

    const update = await connection.pool
      .query("update group_activity_log set action = 'settlement_created' where subject_id = $1", [
        saved.id,
      ])
      .catch((error: unknown) => error);
    const remove = await connection.pool
      .query('delete from group_activity_log where subject_id = $1', [saved.id])
      .catch((error: unknown) => error);

    expect((update as Error).message).toMatch(/group_activity_log is immutable/);
    expect((remove as Error).message).toMatch(/group_activity_log is immutable/);
    expect((await reader.list(w.groupId, { limit: 5 })).items).toHaveLength(1);
  });
});
