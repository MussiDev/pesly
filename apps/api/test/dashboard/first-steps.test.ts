import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFirstSteps } from '../../src/dashboard/application/build-first-steps';
import { DrizzleFirstStepsReader } from '../../src/dashboard/infrastructure/db/drizzle-first-steps-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { newMovementAt } from '../budgets/spending-fixtures';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newUserId, readScope } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let reader: DrizzleFirstStepsReader;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  reader = new DrizzleFirstStepsReader(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

async function stepsOf(userId: string) {
  return buildFirstSteps({ firstSteps: reader }, await readScope(userId));
}

describe('first steps', () => {
  it('shows with no account and no movement', async () => {
    const user = await newUserId(connection.db);

    expect(await stepsOf(user)).toEqual({ hasAccount: false, hasMovement: false, show: true });
  });

  it('does not count an archived account', async () => {
    const user = await newUserId(connection.db);
    await newAccount(connection.pool, user, true);

    expect(await stepsOf(user)).toEqual({ hasAccount: false, hasMovement: false, show: true });
  });

  it('shows when only the account exists', async () => {
    const user = await newUserId(connection.db);
    await newAccount(connection.pool, user);

    expect(await stepsOf(user)).toEqual({ hasAccount: true, hasMovement: false, show: true });
  });

  it('hides with one account and one movement, and ignores the rows of another user', async () => {
    const user = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const account = await newAccount(connection.pool, user);
    const category = await newCategory(connection.pool, user, 'expense');
    await newAccount(connection.pool, other);
    await newMovementAt(connection.pool, {
      ownerId: user,
      accountId: account,
      categoryId: category,
      amount: 1000n,
      occurredAt: '2026-10-02T12:00:00Z',
    });

    expect(await stepsOf(user)).toEqual({ hasAccount: true, hasMovement: true, show: false });
    expect(await stepsOf(other)).toEqual({ hasAccount: true, hasMovement: false, show: true });
  });
});
