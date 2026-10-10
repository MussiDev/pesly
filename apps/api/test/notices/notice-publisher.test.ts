import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PublishNoticeInput } from '../../src/recurring/application/ports/notice-publisher';
import { createNoticePublisher } from '../../src/notices';
import { DrizzleNoticePublisher } from '../../src/notices/infrastructure/db/drizzle-notice-publisher';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUserId } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let publisher: DrizzleNoticePublisher;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  publisher = new DrizzleNoticePublisher(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const PAYMENT_ID = '22222222-2222-4222-8222-222222222222';

function reminder(
  ownerId: string,
  overrides: Partial<PublishNoticeInput> = {},
): PublishNoticeInput {
  return {
    ownerId,
    kind: 'reminder',
    paymentId: PAYMENT_ID,
    paymentName: 'Luz',
    dueDate: '2026-10-05',
    language: 'es',
    daysUntilDue: 1,
    ...overrides,
  };
}

const rowsOf = async (ownerId: string) =>
  (
    await connection.pool.query<{ kind: string; text: string; due_date: string }>(
      "select kind, text, to_char(due_date, 'YYYY-MM-DD') as due_date from notices where owner_id = $1 order by text",
      [ownerId],
    )
  ).rows;

describe('DrizzleNoticePublisher.publish', () => {
  it('creates the notice with the rendered text and returns true', async () => {
    const ana = await newUserId(connection.db);

    expect(await publisher.publish(reminder(ana))).toBe(true);

    expect(await rowsOf(ana)).toEqual([
      { kind: 'reminder', text: 'Luz vence mañana', due_date: '2026-10-05' },
    ]);
  });

  it('renders in the owner language', async () => {
    const ana = await newUserId(connection.db);
    await publisher.publish(reminder(ana, { language: 'en', paymentName: 'Electricity' }));
    expect((await rowsOf(ana))[0]?.text).toBe('Electricity is due tomorrow');
  });

  it('publishing the same key three times keeps 1 row and returns false after the first (AC-23)', async () => {
    const ana = await newUserId(connection.db);

    const results = [
      await publisher.publish(reminder(ana)),
      await publisher.publish(reminder(ana)),
      await publisher.publish(reminder(ana)),
    ];

    expect(results).toEqual([true, false, false]);
    expect(await rowsOf(ana)).toHaveLength(1);
  });

  it('keeps 1 row when two publishes of the same key run concurrently (AC-24)', async () => {
    const ana = await newUserId(connection.db);

    const results = await Promise.all([
      publisher.publish(reminder(ana)),
      publisher.publish(reminder(ana)),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await rowsOf(ana)).toHaveLength(1);
  });

  it('treats another kind or another due date as a different notice', async () => {
    const ana = await newUserId(connection.db);
    await publisher.publish(reminder(ana));
    expect(await publisher.publish(reminder(ana, { kind: 'recorded' }))).toBe(true);
    expect(await publisher.publish(reminder(ana, { dueDate: '2026-11-05' }))).toBe(true);
    expect(await rowsOf(ana)).toHaveLength(3);
  });

  it('propagates a storage error unchanged (AC-25)', async () => {
    const missingOwner = '33333333-3333-4333-8333-333333333333';
    await expect(publisher.publish(reminder(missingOwner))).rejects.toThrow();
  });
});

describe('DrizzleNoticePublisher.publishMany', () => {
  it('inserts a page in one statement and returns how many were created', async () => {
    const ana = await newUserId(connection.db);
    const batch = [
      reminder(ana, { paymentId: '44444444-4444-4444-8444-444444444441', paymentName: 'A' }),
      reminder(ana, { paymentId: '44444444-4444-4444-8444-444444444442', paymentName: 'B' }),
    ];

    expect(await publisher.publishMany(batch)).toBe(2);
    expect(await publisher.publishMany(batch)).toBe(0);
    expect(await rowsOf(ana)).toHaveLength(2);
  });

  it('counts only the new ones when part of the page is a duplicate', async () => {
    const ana = await newUserId(connection.db);
    const a = reminder(ana, { paymentId: '44444444-4444-4444-8444-444444444441' });
    const b = reminder(ana, { paymentId: '44444444-4444-4444-8444-444444444442' });
    await publisher.publish(a);

    expect(await publisher.publishMany([a, b])).toBe(1);
  });

  it('does nothing for an empty list', async () => {
    expect(await publisher.publishMany([])).toBe(0);
  });

  it('propagates a storage error unchanged (AC-25)', async () => {
    await expect(
      publisher.publishMany([reminder('33333333-3333-4333-8333-333333333333')]),
    ).rejects.toThrow();
  });
});

describe('createNoticePublisher', () => {
  it('builds a publisher bound to the database', async () => {
    const ana = await newUserId(connection.db);
    expect(await createNoticePublisher(connection.db).publish(reminder(ana))).toBe(true);
  });
});
