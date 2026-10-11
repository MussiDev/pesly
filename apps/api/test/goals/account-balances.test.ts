import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountMovements } from '../../src/movements';
import { DrizzleAccountBalances } from '../../src/goals/infrastructure/db/drizzle-account-balances';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  newAccount,
  newCategory,
  newMovement,
  newTransfer,
  newUserId,
  readScope,
} from '../movements/db-fixtures';

let connection: DatabaseConnection;
let balances: DrizzleAccountBalances;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  const movements = createAccountMovements(connection.db);
  balances = new DrizzleAccountBalances(connection.db, (ids) => movements.sumsByAccount(ids));
});

afterAll(async () => {
  await connection.pool.end();
});

describe('DrizzleAccountBalances.balancesOf', () => {
  it('is the opening balance plus movement sums, including a transfer in, and follows new movements (AC-04)', async () => {
    const userId = await newUserId(connection.db);
    const scope = await readScope(userId);
    const source = await newAccount(connection.pool, userId, false, 'USD');
    const target = await newAccount(connection.pool, userId, false, 'USD');
    await connection.pool.query('update accounts set opening_balance = 50000 where id = $1', [
      target,
    ]);
    const category = await newCategory(connection.pool, userId, 'income');
    await newMovement(connection.pool, {
      ownerId: userId,
      accountId: target,
      categoryId: category,
      type: 'income',
      amount: 10_000n,
    });
    await newTransfer(connection.pool, {
      ownerId: userId,
      accountId: source,
      destinationAccountId: target,
      amount: 3_000n,
    });

    expect((await balances.balancesOf(scope, [source, target])).get(target)).toBe(63_000n);
    expect((await balances.balancesOf(scope, [source])).get(source)).toBe(-3_000n);

    await newMovement(connection.pool, {
      ownerId: userId,
      accountId: target,
      categoryId: category,
      type: 'income',
      amount: 7_000n,
    });
    expect((await balances.balancesOf(scope, [target])).get(target)).toBe(70_000n);
  });

  it('omits ids of another user and missing ids (AC-15)', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const beaAccount = await newAccount(connection.pool, bea);

    const result = await balances.balancesOf(await readScope(ana), [
      beaAccount,
      '00000000-0000-4000-8000-000000000000',
    ]);

    expect(result.size).toBe(0);
  });

  it('reads 1,200 account ids in chunks of at most 500 (NFR-02)', async () => {
    const userId = await newUserId(connection.db);
    const scope = await readScope(userId);
    const created = await connection.pool.query<{ id: string }>(
      `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
       select $1, 'Caja ' || n, 'cash', 'ARS', 0, true from generate_series(1, 1200) n returning id`,
      [userId],
    );
    const ids = created.rows.map((row) => row.id);
    const own = ids[0] ?? '';
    const sizes: number[] = [];
    const chunked = new DrizzleAccountBalances(connection.db, (ids) => {
      sizes.push(ids.length);
      return Promise.resolve(new Map(ids.map((id) => [id, 5n])));
    });

    const result = await chunked.balancesOf(scope, ids);

    expect(sizes.length).toBeGreaterThanOrEqual(3);
    expect(sizes.every((size) => size <= 500)).toBe(true);
    expect(sizes.reduce((total, size) => total + size, 0)).toBe(1_200);
    expect(result.get(own)).toBe(5n);
  });

  it('propagates a failure of the sums function instead of guessing a balance (sad path)', async () => {
    const userId = await newUserId(connection.db);
    const own = await newAccount(connection.pool, userId);
    const failing = new DrizzleAccountBalances(connection.db, () =>
      Promise.reject(new Error('sums down')),
    );

    await expect(failing.balancesOf(await readScope(userId), [own])).rejects.toThrow('sums down');
  });

  it('answers an empty map for no ids', async () => {
    const userId = await newUserId(connection.db);

    expect((await balances.balancesOf(await readScope(userId), [])).size).toBe(0);
  });
});

describe('DrizzleAccountBalances.findLinkable', () => {
  it('returns currency and the archived flag of the own account (AC-18)', async () => {
    const userId = await newUserId(connection.db);
    const scope = await readScope(userId);
    const active = await newAccount(connection.pool, userId, false, 'USD');
    const archived = await newAccount(connection.pool, userId, true, 'ARS');

    expect(await balances.findLinkable(scope, active)).toEqual({
      id: active,
      currency: 'USD',
      archived: false,
    });
    expect(await balances.findLinkable(scope, archived)).toEqual({
      id: archived,
      currency: 'ARS',
      archived: true,
    });
  });

  it('returns null for another user and for a missing account (AC-18)', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const beaAccount = await newAccount(connection.pool, bea);
    const scope = await readScope(ana);

    expect(await balances.findLinkable(scope, beaAccount)).toBeNull();
    expect(await balances.findLinkable(scope, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
