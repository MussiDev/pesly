import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleUserDeletionRepository } from '../../src/identity/infrastructure/db/drizzle-user-deletion-repository';
import { eraseUserMovements } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  newAccount,
  newCategory,
  newExchange,
  newMovement,
  newTransfer,
  newUserId,
} from './db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const SERVER_FILE = new URL('../../src/server.ts', import.meta.url);

async function count(statement: string, params: unknown[]): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(statement, params);
  return Number(result.rows[0]?.n);
}

const movementsOf = (ownerId: string) =>
  count('select count(*) as n from movements where owner_id = $1', [ownerId]);
const accountsOf = (ownerId: string) =>
  count('select count(*) as n from accounts where owner_id = $1', [ownerId]);
const usersWith = (id: string) => count('select count(*) as n from users where id = $1', [id]);

/** A user with an account, an expense category and `movements` expenses between them. */
async function userWithMovements(movements: number) {
  const ownerId = await newUserId(connection.db);
  const accountId = await newAccount(connection.pool, ownerId);
  const categoryId = await newCategory(connection.pool, ownerId, 'expense');
  for (let i = 0; i < movements; i += 1) {
    await newMovement(connection.pool, {
      ownerId,
      accountId,
      categoryId,
      type: 'expense',
      amount: 100n,
    });
  }
  return { ownerId, accountId, categoryId };
}

const eraseWithStep = (userId: string) =>
  new DrizzleUserDeletionRepository(connection.db, [eraseUserMovements]).erase({
    userId,
    credentialsVersion: 0,
  });

describe('eraseUserMovements', () => {
  it("deletes only the user's movements and leaves their accounts and another user's movements", async () => {
    const ana = await userWithMovements(3);
    const bea = await userWithMovements(2);

    await connection.db.transaction((tx) => eraseUserMovements(tx, ana.ownerId));

    expect(await movementsOf(ana.ownerId)).toBe(0);
    expect(await accountsOf(ana.ownerId)).toBe(1);
    expect(await movementsOf(bea.ownerId)).toBe(2);
  });

  it('deletes transfers and exchanges, whose destination key also restricts the accounts', async () => {
    const ana = await userWithMovements(1);
    const usd = await newAccount(connection.pool, ana.ownerId, false, 'USD');
    const second = await newAccount(connection.pool, ana.ownerId);
    await newTransfer(connection.pool, {
      ownerId: ana.ownerId,
      accountId: ana.accountId,
      destinationAccountId: second,
      amount: 10n,
    });
    await newExchange(connection.pool, {
      ownerId: ana.ownerId,
      accountId: ana.accountId,
      destinationAccountId: usd,
      amount: 15_000n,
      destinationAmount: 10n,
      rate: 15_000_000n,
    });
    expect(await movementsOf(ana.ownerId)).toBe(3);

    expect(await eraseWithStep(ana.ownerId)).toBe('erased');

    expect(await movementsOf(ana.ownerId)).toBe(0);
    expect(await accountsOf(ana.ownerId)).toBe(0);
    expect(await usersWith(ana.ownerId)).toBe(0);
  });

  it('is a no-op for a user without movements', async () => {
    const ana = await userWithMovements(0);
    const bea = await userWithMovements(1);

    await connection.db.transaction((tx) => eraseUserMovements(tx, ana.ownerId));

    expect(await accountsOf(ana.ownerId)).toBe(1);
    expect(await movementsOf(bea.ownerId)).toBe(1);
  });
});

describe('erasing a user with the movements step', () => {
  it('leaves no movement, rate-limit window, account or category of the user and keeps the other user rows', async () => {
    const ana = await userWithMovements(2);
    const bea = await userWithMovements(2);
    for (const { ownerId } of [ana, bea]) {
      await connection.pool.query(
        'insert into movement_rate_limits (owner_id, window_start, count) values ($1, now(), 1)',
        [ownerId],
      );
    }

    expect(await eraseWithStep(ana.ownerId)).toBe('erased');

    expect(await usersWith(ana.ownerId)).toBe(0);
    expect(await movementsOf(ana.ownerId)).toBe(0);
    expect(await accountsOf(ana.ownerId)).toBe(0);
    expect(
      await count('select count(*) as n from categories where owner_id = $1', [ana.ownerId]),
    ).toBe(0);
    expect(
      await count('select count(*) as n from movement_rate_limits where owner_id = $1', [
        ana.ownerId,
      ]),
    ).toBe(0);
    expect(await movementsOf(bea.ownerId)).toBe(2);
    expect(await accountsOf(bea.ownerId)).toBe(1);
    expect(
      await count('select count(*) as n from movement_rate_limits where owner_id = $1', [
        bea.ownerId,
      ]),
    ).toBe(1);
  });

  it('rolls the whole deletion back when the movements delete fails (error path)', async () => {
    const ana = await userWithMovements(2);
    const guard = ana.ownerId.replaceAll('-', '_');
    // The owner id is a UUID generated here, so inlining it in the DDL is safe; the `when` keeps
    // every other user's movements deletable.
    await connection.pool.query(`
      create function forced_movements_failure_${guard}() returns trigger language plpgsql as $$
      begin raise exception 'forced failure'; end $$`);
    await connection.pool.query(`
      create trigger forced_movements_failure_${guard} before delete on movements
      for each row when (old.owner_id = '${ana.ownerId}') execute function forced_movements_failure_${guard}()`);
    try {
      await expect(eraseWithStep(ana.ownerId)).rejects.toMatchObject({
        cause: { message: 'forced failure' },
      });
    } finally {
      await connection.pool.query(`drop trigger forced_movements_failure_${guard} on movements`);
      await connection.pool.query(`drop function forced_movements_failure_${guard}()`);
    }

    expect(await usersWith(ana.ownerId)).toBe(1);
    expect(await accountsOf(ana.ownerId)).toBe(1);
    expect(await movementsOf(ana.ownerId)).toBe(2);
  });

  it('waits for a movement insert in flight and then erases it with the rest', async () => {
    const ana = await userWithMovements(1);
    const holder = new pg.Client({ connectionString: testDatabaseUrl });
    await holder.connect();
    await holder.query('begin');
    await holder.query(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
       values ($1, 'expense', $2, $3, 5, now(), 14000000, 'manual')`,
      [ana.ownerId, ana.accountId, ana.categoryId],
    );
    try {
      const erasing = eraseWithStep(ana.ownerId);
      // Long enough for the erasure to reach the user-row lock and wait on the insert.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await holder.query('commit');

      expect(await erasing).toBe('erased');
    } finally {
      await holder.end();
    }

    expect(await usersWith(ana.ownerId)).toBe(0);
    expect(await movementsOf(ana.ownerId)).toBe(0);
  });

  it('ends cleanly when an insert races the erasure: the deletion succeeds and no row remains, or the insert fails on the foreign key (race)', async () => {
    const outcomes = new Set<string>();
    for (let round = 0; round < 5; round += 1) {
      const ana = await userWithMovements(1);

      const [erased, inserted] = await Promise.allSettled([
        eraseWithStep(ana.ownerId),
        newMovement(connection.pool, {
          ownerId: ana.ownerId,
          accountId: ana.accountId,
          categoryId: ana.categoryId,
          type: 'expense',
          amount: 7n,
        }),
      ]);

      expect(erased.status).toBe('fulfilled');
      if (inserted.status === 'rejected') {
        expect((inserted.reason as { code?: string }).code).toBe('23503');
      }
      outcomes.add(inserted.status);
      expect(await usersWith(ana.ownerId)).toBe(0);
      expect(await movementsOf(ana.ownerId)).toBe(0);
    }
    expect(outcomes.size).toBeGreaterThan(0);
  });
});

describe('the composition root', () => {
  it('passes eraseUserMovements to beforeUserErased and the real adapters to the accounts and categories routes', async () => {
    const source = await readFile(SERVER_FILE, 'utf8');

    // The movements step first, then the cards step (DISC-001-10a D11).
    expect(source).toMatch(
      /beforeUserErased:\s*\[\s*eraseUserMovements,\s*eraseUserCreditCards,?\s*\]/,
    );
    expect(source).toMatch(/createAccountRoutes\(\{[^}]*movements:\s*createAccountMovements\(db\)/);
    expect(source).toMatch(/createAccountRoutes\(\{[^}]*links:\s*createCardAccountLinks\(db\)/);
    expect(source).toMatch(
      /createCreditCardRoutes\(\{[^}]*activity:\s*createAccountMovements\(db\)/,
    );
    // The category usage combines the movements adapter with the installment purchases one (10c D7).
    expect(source).toMatch(/createCategoryRoutes\(\{[^}]*usage:\s*categoryUsage/);
    expect(source).toMatch(/movementCategoryUsage\s*=\s*createCategoryUsage\(db\)/);
    expect(source).toMatch(/installmentCategoryUsage\s*=\s*createInstallmentCategoryUsage\(db\)/);
    expect(source).not.toMatch(/NoMovementsAdapter|NoUsageAdapter/);
  });
});
