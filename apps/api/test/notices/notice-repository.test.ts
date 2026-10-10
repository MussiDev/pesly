import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ListNotices } from '../../src/notices/application/list-notices';
import { MarkAllNoticesRead } from '../../src/notices/application/mark-all-notices-read';
import { MarkNoticeRead } from '../../src/notices/application/mark-notice-read';
import { DrizzleNoticeRepository } from '../../src/notices/infrastructure/db/drizzle-notice-repository';
import { ResourceNotFound } from '../../src/shared/access';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUserId, readScope, writeScope } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let repository: DrizzleNoticeRepository;
let listNotices: ListNotices;
let markRead: MarkNoticeRead;
let markAllRead: MarkAllNoticesRead;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleNoticeRepository(connection.db);
  listNotices = new ListNotices(repository);
  markRead = new MarkNoticeRead(repository);
  markAllRead = new MarkAllNoticesRead(repository);
});

afterAll(async () => {
  await connection.pool.end();
});

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

/** Inserts `count` notices for the owner, oldest first, `created_at` one second apart. */
async function seed(ownerId: string, count: number, label = 'n'): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const result = await connection.pool.query<{ id: string }>(
      `insert into notices (owner_id, kind, payment_id, due_date, text, created_at)
       values ($1, 'reminder', gen_random_uuid(), '2026-10-05', $2, now() - make_interval(secs => $3))
       returning id`,
      [ownerId, `${label}-${i}`, count - i],
    );
    ids.push(result.rows[0]?.id ?? '');
  }
  return ids;
}

const readAtOf = async (id: string) =>
  (
    await connection.pool.query<{ read_at: Date | null }>(
      'select read_at from notices where id = $1',
      [id],
    )
  ).rows[0]?.read_at ?? null;

describe('ListNotices', () => {
  it('returns the newest first with the unread count (AC-18)', async () => {
    const ana = await newUserId(connection.db);
    await seed(ana, 3);

    const page = await listNotices.execute(await readScope(ana), { limit: 20 });

    expect(page.items.map((item) => item.text)).toEqual(['n-2', 'n-1', 'n-0']);
    expect(page.unreadCount).toBe(3);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]?.readAt).toBeNull();
  });

  it('pages 60 notices with no overlap and no gap, 50 at most per page (AC-18)', async () => {
    const ana = await newUserId(connection.db);
    await seed(ana, 60);
    const scope = await readScope(ana);

    const first = await listNotices.execute(scope, { limit: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();

    const second = await listNotices.execute(scope, {
      limit: 50,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });
    expect(second.items).toHaveLength(10);
    expect(second.nextCursor).toBeNull();

    const ids = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(60);
    expect(second.unreadCount).toBe(60);
  });

  it('keeps pages stable when notices share the same created_at', async () => {
    const ana = await newUserId(connection.db);
    await connection.pool.query(
      `insert into notices (owner_id, kind, payment_id, due_date, text, created_at)
       select $1, 'reminder', gen_random_uuid(), '2026-10-05', 't' || g, '2026-10-01T00:00:00Z'
       from generate_series(1, 5) g`,
      [ana],
    );
    const scope = await readScope(ana);

    const first = await listNotices.execute(scope, { limit: 2 });
    const second = await listNotices.execute(scope, {
      limit: 2,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });
    const third = await listNotices.execute(scope, {
      limit: 2,
      ...(second.nextCursor ? { cursor: second.nextCursor } : {}),
    });

    const ids = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(third.nextCursor).toBeNull();
  });

  it('caps the page at 50 even when more is asked', async () => {
    const ana = await newUserId(connection.db);
    await seed(ana, 55);
    const page = await listNotices.execute(await readScope(ana), { limit: 500 });
    expect(page.items).toHaveLength(50);
  });

  it('never lists another user notice nor counts it (AC-22)', async () => {
    const ana = await newUserId(connection.db);
    const bob = await newUserId(connection.db);
    await seed(ana, 2, 'ana');
    await seed(bob, 3, 'bob');

    const page = await listNotices.execute(await readScope(ana), { limit: 20 });

    expect(page.items.map((item) => item.text)).toEqual(['ana-1', 'ana-0']);
    expect(page.unreadCount).toBe(2);
  });
});

describe('MarkNoticeRead', () => {
  it('marks one read, keeps it listed and lowers the count by 1 (AC-20)', async () => {
    const ana = await newUserId(connection.db);
    const [first] = await seed(ana, 2);

    const notice = await markRead.execute(await writeScope(ana), first ?? '');

    expect(notice.readAt).not.toBeNull();
    const page = await listNotices.execute(await readScope(ana), { limit: 20 });
    expect(page.items).toHaveLength(2);
    expect(page.items.find((item) => item.id === first)?.readAt).not.toBeNull();
    expect(page.unreadCount).toBe(1);
  });

  it('keeps the first read_at when marked again (AC-20)', async () => {
    const ana = await newUserId(connection.db);
    const [id] = await seed(ana, 1);
    const scope = await writeScope(ana);

    await markRead.execute(scope, id ?? '');
    const firstReadAt = await readAtOf(id ?? '');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const again = await markRead.execute(scope, id ?? '');

    expect(firstReadAt).not.toBeNull();
    expect((await readAtOf(id ?? ''))?.getTime()).toBe(firstReadAt?.getTime());
    expect(again.readAt).not.toBeNull();
  });

  it('answers ResourceNotFound for another user notice and leaves the row unchanged (AC-22)', async () => {
    const ana = await newUserId(connection.db);
    const bob = await newUserId(connection.db);
    const [bobNotice] = await seed(bob, 1);

    await expect(markRead.execute(await writeScope(ana), bobNotice ?? '')).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    expect(await readAtOf(bobNotice ?? '')).toBeNull();
  });

  it('answers ResourceNotFound for an id that does not exist (AC-22)', async () => {
    const ana = await newUserId(connection.db);
    await expect(markRead.execute(await writeScope(ana), MISSING_ID)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
  });
});

describe('MarkAllNoticesRead', () => {
  it('sets the unread count to 0 and touches only the caller notices (AC-21)', async () => {
    const ana = await newUserId(connection.db);
    const bob = await newUserId(connection.db);
    await seed(ana, 4);
    const [bobNotice] = await seed(bob, 2);

    const result = await markAllRead.execute(await writeScope(ana));

    expect(result).toEqual({ updated: 4 });
    expect((await listNotices.execute(await readScope(ana), { limit: 20 })).unreadCount).toBe(0);
    expect(await readAtOf(bobNotice ?? '')).toBeNull();
    expect((await listNotices.execute(await readScope(bob), { limit: 20 })).unreadCount).toBe(2);
  });

  it('updates nothing the second time and keeps the first read_at (AC-21)', async () => {
    const ana = await newUserId(connection.db);
    const [id] = await seed(ana, 1);
    const scope = await writeScope(ana);

    await markAllRead.execute(scope);
    const firstReadAt = await readAtOf(id ?? '');
    const second = await markAllRead.execute(scope);

    expect(second).toEqual({ updated: 0 });
    expect((await readAtOf(id ?? ''))?.getTime()).toBe(firstReadAt?.getTime());
  });
});

describe('storage errors', () => {
  it('propagates a storage error from the repository unchanged (AC-25)', async () => {
    const owner = await newUserId(connection.db);
    const broken = createDatabase(testDatabaseUrl);
    await broken.pool.end();
    const failing = new ListNotices(new DrizzleNoticeRepository(broken.db));

    await expect(failing.execute(await readScope(owner), { limit: 10 })).rejects.toThrow();
  });
});
