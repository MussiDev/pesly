import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleUserDeletionRepository } from '../../src/identity/infrastructure/db/drizzle-user-deletion-repository';
import { eraseUserGoals } from '../../src/goals/infrastructure/db/erase-user-goals';
import { eraseUserMovements } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newUserId } from '../movements/db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const count = async (statement: string, params: unknown[]): Promise<number> => {
  const result = await connection.pool.query<{ n: string }>(statement, params);
  return Number(result.rows[0]?.n);
};
const goalsOf = (ownerId: string) =>
  count('select count(*) as n from goals where owner_id = $1', [ownerId]);
const entriesOf = (ownerId: string) =>
  count('select count(*) as n from goal_entries where owner_id = $1', [ownerId]);
const usersWith = (id: string) => count('select count(*) as n from users where id = $1', [id]);

/** A user with a goal linked to their account and a manual goal with one entry. */
async function userWithGoals(): Promise<string> {
  const ownerId = await newUserId(connection.db);
  const accountId = await newAccount(connection.pool, ownerId);
  await connection.pool.query(
    `insert into goals (owner_id, name, target_amount, currency, linked_account_id)
     values ($1, 'Linked', 100000, 'ARS', $2)`,
    [ownerId, accountId],
  );
  const manual = await connection.pool.query<{ id: string }>(
    `insert into goals (owner_id, name, target_amount, currency)
     values ($1, 'Manual', 50000, 'ARS') returning id`,
    [ownerId],
  );
  await connection.pool.query(
    `insert into goal_entries (goal_id, owner_id, kind, amount) values ($1, $2, 'contribution', 1000)`,
    [manual.rows[0]?.id, ownerId],
  );
  return ownerId;
}

const erase = (
  userId: string,
  steps: ConstructorParameters<typeof DrizzleUserDeletionRepository>[1],
) =>
  new DrizzleUserDeletionRepository(connection.db, steps).erase({ userId, credentialsVersion: 0 });

describe('eraseUserGoals', () => {
  it("deletes only the user's goals and entries (FR-11)", async () => {
    const ana = await userWithGoals();
    const bea = await userWithGoals();

    await connection.db.transaction((tx) => eraseUserGoals(tx, ana));

    expect(await goalsOf(ana)).toBe(0);
    expect(await entriesOf(ana)).toBe(0);
    expect(await goalsOf(bea)).toBe(2);
    expect(await entriesOf(bea)).toBe(1);
  });

  it('lets a user with a linked goal be erased when registered before the movements step', async () => {
    const ana = await userWithGoals();

    await erase(ana, [eraseUserGoals, eraseUserMovements]);

    expect(await usersWith(ana)).toBe(0);
    expect(await goalsOf(ana)).toBe(0);
  });

  it('is needed because the restricting key refuses to delete the account first (sad path)', async () => {
    const ana = await userWithGoals();

    await expect(
      connection.pool.query('delete from accounts where owner_id = $1', [ana]),
    ).rejects.toMatchObject({ code: '23503' });
    expect(await goalsOf(ana)).toBe(2);

    await connection.db.transaction((tx) => eraseUserGoals(tx, ana));
    await connection.pool.query('delete from accounts where owner_id = $1', [ana]);
    expect(await count('select count(*) as n from accounts where owner_id = $1', [ana])).toBe(0);
  });
});
