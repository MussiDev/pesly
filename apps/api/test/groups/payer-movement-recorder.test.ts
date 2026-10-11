import { RateRequired } from '../../src/movements/domain/errors';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzlePayerMovementRecorder } from '../../src/groups/infrastructure/movements/drizzle-payer-movement-recorder';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newUserId } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let recorder: DrizzlePayerMovementRecorder;

const NOW = new Date('2026-10-10T12:00:00.000Z');

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  recorder = new DrizzlePayerMovementRecorder(connection.db, { now: () => NOW });
});

afterAll(async () => {
  await connection.pool.end();
});

async function seedRates(): Promise<void> {
  await connection.pool.query(
    `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
     values ('mep', 12900000, 13000000, now(), now()), ('blue', 13900000, 14000000, now(), now())`,
  );
}

beforeEach(seedRates);

async function world() {
  const userId = await newUserId(connection.db, { rateType: 'mep', timeZone: 'America/Cordoba' });
  const accountId = await newAccount(connection.pool, userId, false, 'ARS');
  const categoryId = await newCategory(connection.pool, userId, 'expense');
  return { userId, accountId, categoryId };
}

interface MovementRow {
  type: string;
  account_id: string;
  category_id: string;
  amount: string;
  occurred_at: Date;
  note: string | null;
  rate: string;
  rate_source: string;
  rate_type: string | null;
}

async function storedMovement(id: string): Promise<MovementRow | undefined> {
  const result = await connection.pool.query<MovementRow>('select * from movements where id = $1', [
    id,
  ]);
  return result.rows[0];
}

describe('isUsable', () => {
  it('accepts the caller own open account in the currency and an own expense category', async () => {
    const { userId, accountId, categoryId } = await world();
    expect(await recorder.isUsable({ userId, accountId, categoryId, currency: 'ARS' })).toBe(true);
  });

  it('rejects another currency, another owner, an income category and an archived account (sad path)', async () => {
    const { userId, accountId, categoryId } = await world();
    const other = await world();
    const income = await newCategory(connection.pool, userId, 'income');
    const archived = await newAccount(connection.pool, userId, true, 'ARS');

    expect(await recorder.isUsable({ userId, accountId, categoryId, currency: 'USD' })).toBe(false);
    expect(
      await recorder.isUsable({ userId, accountId: other.accountId, categoryId, currency: 'ARS' }),
    ).toBe(false);
    expect(
      await recorder.isUsable({ userId, accountId, categoryId: other.categoryId, currency: 'ARS' }),
    ).toBe(false);
    expect(
      await recorder.isUsable({ userId, accountId, categoryId: income, currency: 'ARS' }),
    ).toBe(false);
    expect(
      await recorder.isUsable({ userId, accountId: archived, categoryId, currency: 'ARS' }),
    ).toBe(false);
  });
});

describe('record', () => {
  it('stores an expense of the full amount with the rate of the group rate type and the note', async () => {
    const { userId, accountId, categoryId } = await world();

    const { id } = await connection.db.transaction((tx) =>
      recorder.record(tx, {
        userId,
        accountId,
        categoryId,
        amount: 4_000_000n,
        occurredAt: new Date('2026-10-09T15:00:00.000Z'),
        note: 'Supermercado',
        rateType: 'blue',
      }),
    );

    const row = await storedMovement(id);
    expect(row).toMatchObject({
      type: 'expense',
      account_id: accountId,
      category_id: categoryId,
      amount: '4000000',
      note: 'Supermercado',
      rate: '14000000',
      rate_source: 'automatic',
      rate_type: 'blue',
    });
    expect(row?.occurred_at.toISOString()).toBe('2026-10-09T15:00:00.000Z');
  });

  it('clamps a date up to 1 day ahead to the last instant of today in the user time zone', async () => {
    const { userId, accountId, categoryId } = await world();

    const { id } = await connection.db.transaction((tx) =>
      recorder.record(tx, {
        userId,
        accountId,
        categoryId,
        amount: 100n,
        occurredAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
        note: 'Mañana',
        rateType: 'mep',
      }),
    );

    // Today in Cordoba (UTC-3) is 2026-10-10, which ends at 2026-10-11T02:59:59.999Z.
    expect((await storedMovement(id))?.occurred_at.toISOString()).toBe('2026-10-11T02:59:59.999Z');
  });

  it('keeps a date that is still today in the user time zone untouched', async () => {
    const { userId, accountId, categoryId } = await world();
    const occurredAt = new Date('2026-10-11T01:00:00.000Z');

    const { id } = await connection.db.transaction((tx) =>
      recorder.record(tx, {
        userId,
        accountId,
        categoryId,
        amount: 100n,
        occurredAt,
        note: 'Tarde',
        rateType: 'mep',
      }),
    );

    expect((await storedMovement(id))?.occurred_at.toISOString()).toBe(occurredAt.toISOString());
  });

  it('leaves no movement when the surrounding transaction rolls back', async () => {
    const { userId, accountId, categoryId } = await world();
    let recorded = '';

    await expect(
      connection.db.transaction(async (tx) => {
        recorded = (
          await recorder.record(tx, {
            userId,
            accountId,
            categoryId,
            amount: 100n,
            occurredAt: NOW,
            note: 'x',
            rateType: 'mep',
          })
        ).id;
        throw new Error('forced failure');
      }),
    ).rejects.toThrow('forced failure');

    expect(recorded).not.toBe('');
    expect(await storedMovement(recorded)).toBeUndefined();
  });

  it('fails with the movement rate error when no rate is stored for the group rate type (sad path)', async () => {
    const { userId, accountId, categoryId } = await world();
    await connection.pool.query("delete from exchange_rates where rate_type = 'blue'");

    await expect(
      connection.db.transaction((tx) =>
        recorder.record(tx, {
          userId,
          accountId,
          categoryId,
          amount: 100n,
          occurredAt: NOW,
          note: 'x',
          rateType: 'blue',
        }),
      ),
    ).rejects.toBeInstanceOf(RateRequired);
  });
});

describe('update', () => {
  async function recorded() {
    const { userId, accountId, categoryId } = await world();
    const { id } = await connection.db.transaction((tx) =>
      recorder.record(tx, {
        userId,
        accountId,
        categoryId,
        amount: 4_000_000n,
        occurredAt: new Date('2026-10-09T15:00:00.000Z'),
        note: 'Supermercado',
        rateType: 'mep',
      }),
    );
    return { userId, accountId, categoryId, id };
  }

  it('rewrites amount, date and note on the same account and category and keeps the frozen rate', async () => {
    const { userId, accountId, categoryId, id } = await recorded();
    await connection.pool.query('delete from exchange_rates');

    await connection.db.transaction((tx) =>
      recorder.update(tx, {
        userId,
        movementId: id,
        amount: 5_500_000n,
        occurredAt: new Date('2026-10-08T10:00:00.000Z'),
        note: 'Verduleria',
        rateType: 'blue',
      }),
    );

    const row = await storedMovement(id);
    expect(row).toMatchObject({
      account_id: accountId,
      category_id: categoryId,
      amount: '5500000',
      note: 'Verduleria',
      rate: '13000000',
      rate_type: 'mep',
    });
    expect(row?.occurred_at.toISOString()).toBe('2026-10-08T10:00:00.000Z');
  });

  it('clamps a date one day ahead to the end of today in the payer time zone', async () => {
    const { userId, id } = await recorded();

    await connection.db.transaction((tx) =>
      recorder.update(tx, {
        userId,
        movementId: id,
        amount: 100n,
        occurredAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
        note: 'Mañana',
        rateType: 'mep',
      }),
    );

    expect((await storedMovement(id))?.occurred_at.toISOString()).toBe('2026-10-11T02:59:59.999Z');
  });

  it('does nothing and does not fail for a missing movement', async () => {
    const { userId } = await world();

    await expect(
      connection.db.transaction((tx) =>
        recorder.update(tx, {
          userId,
          movementId: '00000000-0000-4000-8000-000000000000',
          amount: 100n,
          occurredAt: NOW,
          note: 'x',
          rateType: 'mep',
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('does not touch a movement of another user (404 as missing)', async () => {
    const { id } = await recorded();
    const stranger = await world();

    await connection.db.transaction((tx) =>
      recorder.update(tx, {
        userId: stranger.userId,
        movementId: id,
        amount: 1n,
        occurredAt: NOW,
        note: 'hijack',
        rateType: 'mep',
      }),
    );

    expect((await storedMovement(id))?.amount).toBe('4000000');
  });
});

describe('remove', () => {
  it('deletes the movement under the payer scope', async () => {
    const { userId, accountId, categoryId } = await world();
    const { id } = await connection.db.transaction((tx) =>
      recorder.record(tx, {
        userId,
        accountId,
        categoryId,
        amount: 100n,
        occurredAt: NOW,
        note: 'x',
        rateType: 'mep',
      }),
    );

    await connection.db.transaction((tx) => recorder.remove(tx, { userId, movementId: id }));

    expect(await storedMovement(id)).toBeUndefined();
  });

  it('does nothing for a missing movement and keeps a movement of another user', async () => {
    const { userId, accountId, categoryId } = await world();
    const stranger = await world();
    const { id } = await connection.db.transaction((tx) =>
      recorder.record(tx, {
        userId,
        accountId,
        categoryId,
        amount: 100n,
        occurredAt: NOW,
        note: 'x',
        rateType: 'mep',
      }),
    );

    await connection.db.transaction(async (tx) => {
      await recorder.remove(tx, { userId, movementId: '00000000-0000-4000-8000-000000000000' });
      await recorder.remove(tx, { userId: stranger.userId, movementId: id });
    });

    expect(await storedMovement(id)).toBeDefined();
  });
});
