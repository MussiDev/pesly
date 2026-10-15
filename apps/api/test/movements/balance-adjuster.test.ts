import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBalanceAdjuster } from '../../src/movements/infrastructure/accounts/drizzle-balance-adjuster';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newMovement, newUserId } from './db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

interface Row {
  type: string;
  amount: string;
  category_id: string | null;
  rate: string | null;
  rate_source: string | null;
  rate_type: string | null;
  destination_account_id: string | null;
  destination_amount: string | null;
  note: string | null;
  owner_id: string;
  occurred_at: Date;
}

async function rowsOf(accountId: string): Promise<Row[]> {
  const result = await connection.pool.query<Row>(
    `select type, amount::text, category_id, rate::text, rate_source, rate_type,
            destination_account_id, destination_amount::text, note, owner_id, occurred_at
       from movements where account_id = $1 and type = 'adjustment' order by created_at`,
    [accountId],
  );
  return result.rows;
}

async function setup() {
  const ownerId = await newUserId(connection.db);
  const accountId = await newAccount(connection.pool, ownerId);
  return { ownerId, accountId };
}

const adjuster = () => createBalanceAdjuster(connection.db);

describe('DrizzleBalanceAdjuster', () => {
  it('inserts target minus current, dated now, with no category, rate or destination (AC-01, AC-02)', async () => {
    const { ownerId, accountId } = await setup();
    const before = Date.now();

    const result = await adjuster().adjust({ ownerId, accountId, target: 2500n, note: 'count' });

    expect(result.status).toBe('adjusted');
    if (result.status !== 'adjusted') return;
    expect(result.balance).toBe(2500n);
    expect(result.adjustment?.amount).toBe(2500n);
    expect(result.adjustment?.note).toBe('count');
    const [row] = await rowsOf(accountId);
    expect(row).toMatchObject({
      type: 'adjustment',
      amount: '2500',
      category_id: null,
      rate: null,
      rate_source: null,
      rate_type: null,
      destination_account_id: null,
      destination_amount: null,
      note: 'count',
      owner_id: ownerId,
    });
    expect(Math.abs((row?.occurred_at.getTime() ?? 0) - before)).toBeLessThan(10_000);
  });

  it('computes the difference from opening balance plus income, expense and earlier adjustments (AC-01)', async () => {
    const { ownerId, accountId } = await setup();
    await connection.pool.query('update accounts set opening_balance = 1000 where id = $1', [
      accountId,
    ]);
    const expense = await newCategory(connection.pool, ownerId, 'expense');
    const income = await newCategory(connection.pool, ownerId, 'income');
    await newMovement(connection.pool, {
      ownerId,
      accountId,
      categoryId: expense,
      type: 'expense',
      amount: 300n,
    });
    await newMovement(connection.pool, {
      ownerId,
      accountId,
      categoryId: income,
      type: 'income',
      amount: 50n,
    });

    const first = await adjuster().adjust({ ownerId, accountId, target: 100n, note: null });
    const second = await adjuster().adjust({ ownerId, accountId, target: 400n, note: null });

    expect(first).toMatchObject({ status: 'adjusted', balance: 100n });
    expect(second).toMatchObject({ status: 'adjusted', balance: 400n });
    const amounts = (await rowsOf(accountId)).map((row) => row.amount);
    // 1000 - 300 + 50 = 750 -> 100 is -650; then 100 -> 400 is +300.
    expect(amounts).toEqual(['-650', '300']);
  });

  it('inserts nothing when the target equals the balance (AC-11)', async () => {
    const { ownerId, accountId } = await setup();
    const result = await adjuster().adjust({ ownerId, accountId, target: 0n, note: null });
    expect(result).toEqual({ status: 'adjusted', balance: 0n, adjustment: null });
    expect(await rowsOf(accountId)).toHaveLength(0);
  });

  it('accepts a negative target (AC-12)', async () => {
    const { ownerId, accountId } = await setup();
    const result = await adjuster().adjust({ ownerId, accountId, target: -900n, note: null });
    expect(result).toMatchObject({ status: 'adjusted', balance: -900n });
    expect((await rowsOf(accountId)).map((row) => row.amount)).toEqual(['-900']);
  });

  it('answers not_found for another owner and for a missing account, writing nothing (AC-16, R-02) (sad path)', async () => {
    const { accountId } = await setup();
    const stranger = await newUserId(connection.db);
    expect(
      await adjuster().adjust({ ownerId: stranger, accountId, target: 5n, note: null }),
    ).toEqual({ status: 'not_found' });
    expect(
      await adjuster().adjust({
        ownerId: stranger,
        accountId: '33333333-3333-4333-8333-333333333333',
        target: 5n,
        note: null,
      }),
    ).toEqual({ status: 'not_found' });
    expect(await rowsOf(accountId)).toHaveLength(0);
  });

  it('answers archived and writes nothing (AC-14) (sad path)', async () => {
    const ownerId = await newUserId(connection.db);
    const accountId = await newAccount(connection.pool, ownerId, true);
    expect(await adjuster().adjust({ ownerId, accountId, target: 5n, note: null })).toEqual({
      status: 'archived',
    });
    expect(await rowsOf(accountId)).toHaveLength(0);
  });

  it('answers credit_card (even archived) and writes nothing (sad path)', async () => {
    const ownerId = await newUserId(connection.db);
    const card = await connection.pool.query<{ id: string }>(
      `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
       values ($1, 'Visa', 'credit_card', 'ARS', 0, false) returning id`,
      [ownerId],
    );
    const accountId = card.rows[0]?.id ?? '';
    expect(await adjuster().adjust({ ownerId, accountId, target: 5n, note: null })).toEqual({
      status: 'credit_card',
    });
    expect(await rowsOf(accountId)).toHaveLength(0);
  });

  it('answers out_of_range and writes nothing when the difference exceeds the amount limit (sad path)', async () => {
    const { ownerId, accountId } = await setup();
    await connection.pool.query('update accounts set opening_balance = $2 where id = $1', [
      accountId,
      '-1000000000000000',
    ]);
    const result = await adjuster().adjust({
      ownerId,
      accountId,
      target: 1_000_000_000_000_000n,
      note: null,
    });
    expect(result).toEqual({ status: 'out_of_range' });
    expect(await rowsOf(accountId)).toHaveLength(0);
  });

  it('serializes 20 concurrent adjustments on the row lock: no lost update (AC-15, R-03)', async () => {
    const { ownerId, accountId } = await setup();
    const targets = Array.from({ length: 20 }, (_, index) => BigInt((index + 1) * 100));

    const results = await Promise.all(
      targets.map((target) => adjuster().adjust({ ownerId, accountId, target, note: null })),
    );

    for (const [index, result] of results.entries()) {
      expect(result).toMatchObject({ status: 'adjusted', balance: targets[index] });
    }
    const adjustments = (await rowsOf(accountId)).map((row) => BigInt(row.amount));
    const final = adjustments.reduce((sum, amount) => sum + amount, 0n);
    // Each request computed its difference from the balance the previous one left, so the sum of
    // the differences lands exactly on one of the targets (without the lock it would not).
    expect(targets).toContain(final);
    expect(adjustments).toHaveLength(20);
  });
});
