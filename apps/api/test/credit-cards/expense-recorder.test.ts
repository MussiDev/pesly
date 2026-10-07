import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleCreditCardRepository } from '../../src/credit-cards/infrastructure/db/drizzle-credit-card-repository';
import { createExpenseRecorder } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../fakes/mutable-clock';
import { testDatabaseUrl } from '../helpers/test-database';
import { newCategory, newUserId, writeScope } from '../movements/db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const logger = createLogger({ level: 'silent', destination: { write: () => undefined } });

async function setup() {
  const ownerId = await newUserId(connection.db);
  const { card } = await new DrizzleCreditCardRepository(connection.db).create(
    await writeScope(ownerId),
    {
      name: 'Visa',
      closingDay: 24,
      dueDay: 5,
      firstStatement: { period: '2026-10', closingDate: '2026-10-24', dueDate: '2026-11-05' },
    },
  );
  const categoryId = await newCategory(connection.pool, ownerId, 'expense');
  return { ownerId, card, categoryId };
}

describe('createExpenseRecorder.record', () => {
  it('stores an expense on the given account with the frozen rate (FR-01)', async () => {
    const { ownerId, card, categoryId } = await setup();
    const recorder = createExpenseRecorder(connection.db, logger);
    const occurredAt = new Date('2026-10-01T15:00:00Z');

    const recorded = await recorder.record(await writeScope(ownerId), {
      accountId: card.arsAccountId,
      categoryId,
      amount: 12_345n,
      occurredAt,
      note: 'Lunch',
      rate: { source: 'manual', value: 14_000_000n },
    });

    expect(recorded.occurredAt).toEqual(occurredAt);
    const rows = await connection.pool.query<{
      type: string;
      account_id: string;
      category_id: string;
      amount: string;
      rate: string;
      rate_source: string;
      note: string;
      owner_id: string;
    }>(
      'select type, account_id, category_id, amount, rate, rate_source, note, owner_id from movements where id = $1',
      [recorded.id],
    );
    expect(rows.rows).toEqual([
      {
        type: 'expense',
        account_id: card.arsAccountId,
        category_id: categoryId,
        amount: '12345',
        rate: '14000000',
        rate_source: 'manual',
        note: 'Lunch',
        owner_id: ownerId,
      },
    ]);
  });

  it('counts against the manual write limit and refuses the 61st in a minute (sad path)', async () => {
    const { ownerId, card, categoryId } = await setup();
    const recorder = createExpenseRecorder(connection.db, logger, { clock: new MutableClock() });
    const scope = await writeScope(ownerId);
    const expense = {
      accountId: card.arsAccountId,
      categoryId,
      amount: 1n,
      occurredAt: new Date('2026-10-01T15:00:00Z'),
      rate: { source: 'manual' as const, value: 14_000_000n },
    };

    for (let i = 0; i < 60; i += 1) await recorder.record(scope, expense);

    await expect(recorder.record(scope, expense)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const count = await connection.pool.query<{ n: string }>(
      'select count(*) as n from movements where owner_id = $1',
      [ownerId],
    );
    expect(count.rows[0]?.n).toBe('60');
  });

  it('honors a custom writeLimit', async () => {
    const { ownerId, card, categoryId } = await setup();
    const recorder = createExpenseRecorder(connection.db, logger, {
      writeLimit: 1,
      clock: new MutableClock(),
    });
    const scope = await writeScope(ownerId);
    const expense = {
      accountId: card.arsAccountId,
      categoryId,
      amount: 1n,
      occurredAt: new Date('2026-10-01T15:00:00Z'),
      rate: { source: 'manual' as const, value: 14_000_000n },
    };

    await recorder.record(scope, expense);
    await expect(recorder.record(scope, expense)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
