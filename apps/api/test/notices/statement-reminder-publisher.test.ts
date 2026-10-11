import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reminderKey } from '../../src/credit-cards/domain/statement-reminder';
import type { StatementReminderInput } from '../../src/credit-cards/application/ports/statement-reminder-publisher';
import { createStatementReminderPublisher } from '../../src/notices';
import { ListNotices } from '../../src/notices/application/list-notices';
import { DrizzleNoticeRepository } from '../../src/notices/infrastructure/db/drizzle-notice-repository';
import { createNoticePublisher } from '../../src/notices';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUserId, readScope } from '../movements/db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const STATEMENT = '55555555-5555-4555-8555-555555555551';
const OTHER_STATEMENT = '55555555-5555-4555-8555-555555555552';

function input(
  ownerId: string,
  overrides: Partial<StatementReminderInput> = {},
): StatementReminderInput {
  return {
    ownerId,
    statementId: STATEMENT,
    dueDate: '2026-11-05',
    cardName: 'Visa',
    language: 'en',
    ...overrides,
  };
}

const rowsOf = async (ownerId: string) =>
  (
    await connection.pool.query<{ kind: string; text: string; due_date: string }>(
      "select kind, text, to_char(due_date, 'YYYY-MM-DD') as due_date from notices where owner_id = $1 order by due_date, text",
      [ownerId],
    )
  ).rows;

describe('StatementReminderPublisher.publishMany', () => {
  it('stores the rendered notice and counts it (AC-08)', async () => {
    const publisher = createStatementReminderPublisher(connection.db);
    const ana = await newUserId(connection.db);

    expect(await publisher.publishMany([input(ana)])).toBe(1);
    expect(await publisher.publishMany([input(ana, { language: 'es' })])).toBe(0);

    expect(await rowsOf(ana)).toEqual([
      {
        kind: 'card_statement_due',
        text: 'The Visa statement is due on Nov 5',
        due_date: '2026-11-05',
      },
    ]);
  });

  it('publishing the same statement and due date twice stores 1 notice (AC-06)', async () => {
    const publisher = createStatementReminderPublisher(connection.db);
    const ana = await newUserId(connection.db);

    const counts = [
      await publisher.publishMany([input(ana)]),
      await publisher.publishMany([input(ana)]),
    ];

    expect(counts).toEqual([1, 0]);
    expect(await rowsOf(ana)).toHaveLength(1);
  });

  it('two calls started at the same time leave exactly 1 row (AC-06)', async () => {
    const publisher = createStatementReminderPublisher(connection.db);
    const ana = await newUserId(connection.db);

    const counts = await Promise.all([
      publisher.publishMany([input(ana)]),
      publisher.publishMany([input(ana)]),
    ]);

    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await rowsOf(ana)).toHaveLength(1);
  });

  it('inserts a page in one call and counts only the new ones', async () => {
    const publisher = createStatementReminderPublisher(connection.db);
    const ana = await newUserId(connection.db);
    await publisher.publishMany([input(ana)]);

    const created = await publisher.publishMany([
      input(ana),
      input(ana, { statementId: OTHER_STATEMENT }),
    ]);

    expect(created).toBe(1);
    expect(await rowsOf(ana)).toHaveLength(2);
  });

  it('does nothing for an empty list', async () => {
    expect(await createStatementReminderPublisher(connection.db).publishMany([])).toBe(0);
  });

  it('propagates a storage error for an unknown owner (sad path)', async () => {
    await expect(
      createStatementReminderPublisher(connection.db).publishMany([
        input('33333333-3333-4333-8333-333333333333'),
      ]),
    ).rejects.toThrow();
  });
});

describe('StatementReminderPublisher.published', () => {
  it('same statement with another due date is a second notice and each pair is reported (AC-05)', async () => {
    const publisher = createStatementReminderPublisher(connection.db);
    const ana = await newUserId(connection.db);
    await publisher.publishMany([input(ana)]);
    expect(await publisher.publishMany([input(ana, { dueDate: '2026-11-12' })])).toBe(1);

    const found = await publisher.published(ana, [
      { statementId: STATEMENT, dueDate: '2026-11-05' },
      { statementId: STATEMENT, dueDate: '2026-11-12' },
      { statementId: STATEMENT, dueDate: '2026-11-19' },
      { statementId: OTHER_STATEMENT, dueDate: '2026-11-05' },
    ]);

    expect(found).toEqual(
      new Set([reminderKey(STATEMENT, '2026-11-05'), reminderKey(STATEMENT, '2026-11-12')]),
    );
  });

  it('keys have the exact format of the credit-cards reminderKey', async () => {
    const publisher = createStatementReminderPublisher(connection.db);
    const ana = await newUserId(connection.db);
    await publisher.publishMany([input(ana)]);

    const found = await publisher.published(ana, [
      { statementId: STATEMENT, dueDate: '2026-11-05' },
    ]);

    expect([...found]).toEqual([reminderKey(STATEMENT, '2026-11-05')]);
    expect([...found]).toEqual([`${STATEMENT}|2026-11-05`]);
  });

  it('answers an empty set for no refs', async () => {
    const ana = await newUserId(connection.db);
    expect(await createStatementReminderPublisher(connection.db).published(ana, [])).toEqual(
      new Set(),
    );
  });

  it('omits another owner notices and other kinds with the same ids (sad path, cross-user)', async () => {
    const publisher = createStatementReminderPublisher(connection.db);
    const ana = await newUserId(connection.db);
    const bob = await newUserId(connection.db);
    const ref = { statementId: STATEMENT, dueDate: '2026-11-05' };
    await publisher.publishMany([input(bob)]);
    // A recurring reminder of ana with the same payment id and due date, of another kind.
    await createNoticePublisher(connection.db).publish({
      ownerId: ana,
      kind: 'reminder',
      paymentId: STATEMENT,
      paymentName: 'Luz',
      dueDate: '2026-11-05',
      language: 'es',
      daysUntilDue: 1,
    });

    expect(await publisher.published(ana, [ref])).toEqual(new Set());
    expect(await publisher.published(bob, [ref])).toEqual(
      new Set([reminderKey(STATEMENT, '2026-11-05')]),
    );
  });
});

describe('statement reminder notices and owners', () => {
  it('a notice stored for one owner is never in the other owner list (sad path, cross-user)', async () => {
    const publisher = createStatementReminderPublisher(connection.db);
    const ana = await newUserId(connection.db);
    const bob = await newUserId(connection.db);
    await publisher.publishMany([input(bob)]);

    const list = new ListNotices(new DrizzleNoticeRepository(connection.db));
    const anas = await list.execute(await readScope(ana), { limit: 20 });
    const bobs = await list.execute(await readScope(bob), { limit: 20 });

    expect(anas.items).toEqual([]);
    expect(bobs.items.map((item) => item.kind)).toEqual(['card_statement_due']);
  });
});
