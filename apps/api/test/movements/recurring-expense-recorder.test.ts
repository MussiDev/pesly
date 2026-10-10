import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRecurringExpenseRecorder } from '../../src/movements/infrastructure/recurring/drizzle-recurring-expense-recorder';
import { ResourceNotFound } from '../../src/shared/access';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../fakes/mutable-clock';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newUserId, writeScope } from './db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const logger = createLogger({ level: 'silent', destination: { write: () => undefined } });
const occurredAt = new Date('2026-10-01T15:00:00Z');

async function setup(archivedAccount = false) {
  const ownerId = await newUserId(connection.db);
  const accountId = await newAccount(connection.pool, ownerId, archivedAccount);
  const categoryId = await newCategory(connection.pool, ownerId, 'expense');
  const expense = {
    accountId,
    categoryId,
    amount: 5_000n,
    occurredAt,
    note: 'Rent',
    rate: { source: 'manual' as const, value: 14_000_000n },
  };
  return { ownerId, expense };
}

async function countMovements(ownerId: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    'select count(*) as n from movements where owner_id = $1',
    [ownerId],
  );
  return Number(result.rows[0]?.n);
}

describe('createRecurringExpenseRecorder.recordOnce', () => {
  it('records one movement with the given id and returns it (AC-01)', async () => {
    const { ownerId, expense } = await setup();
    const recorder = createRecurringExpenseRecorder(connection.db, logger);
    const id = randomUUID();

    const recorded = await recorder.recordOnce(await writeScope(ownerId), id, expense);

    expect(recorded).toEqual({ id, occurredAt });
    const rows = await connection.pool.query<{ id: string; type: string; amount: string }>(
      'select id, type, amount from movements where owner_id = $1',
      [ownerId],
    );
    expect(rows.rows).toEqual([{ id, type: 'expense', amount: '5000' }]);
  });

  it('returns the stored movement on a second call with the same id and writes nothing (AC-08)', async () => {
    const { ownerId, expense } = await setup();
    const recorder = createRecurringExpenseRecorder(connection.db, logger);
    const scope = await writeScope(ownerId);
    const id = randomUUID();

    const first = await recorder.recordOnce(scope, id, expense);
    const second = await recorder.recordOnce(scope, id, { ...expense, amount: 9_999n });

    expect(second).toEqual(first);
    expect(await countMovements(ownerId)).toBe(1);
    const stored = await connection.pool.query<{ amount: string }>(
      'select amount from movements where id = $1',
      [id],
    );
    expect(stored.rows[0]?.amount).toBe('5000');
  });

  it('does not spend the manual write budget', async () => {
    const { ownerId, expense } = await setup();
    const recorder = createRecurringExpenseRecorder(connection.db, logger, {
      writeLimit: 1,
      clock: new MutableClock(),
    });
    const scope = await writeScope(ownerId);

    await recorder.recordOnce(scope, randomUUID(), expense);
    await recorder.recordOnce(scope, randomUUID(), expense);

    expect(await countMovements(ownerId)).toBe(2);
  });

  it('raises ResourceNotFound when the id belongs to another user (sad path)', async () => {
    const owner = await setup();
    const other = await setup();
    const recorder = createRecurringExpenseRecorder(connection.db, logger);
    const id = randomUUID();
    await recorder.recordOnce(await writeScope(owner.ownerId), id, owner.expense);

    await expect(
      recorder.recordOnce(await writeScope(other.ownerId), id, other.expense),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(await countMovements(other.ownerId)).toBe(0);
  });

  it('raises the movement error and writes nothing for an archived account (AC-03, sad path)', async () => {
    const { ownerId, expense } = await setup(true);
    const recorder = createRecurringExpenseRecorder(connection.db, logger);

    await expect(
      recorder.recordOnce(await writeScope(ownerId), randomUUID(), expense),
    ).rejects.toMatchObject({ code: 'ACCOUNT_ARCHIVED' });
    expect(await countMovements(ownerId)).toBe(0);
  });
});
