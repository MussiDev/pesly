import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleUserDeletionRepository } from '../../src/identity/infrastructure/db/drizzle-user-deletion-repository';
import { eraseUserMovements } from '../../src/movements';
import { DrizzleOccurrenceRepository } from '../../src/recurring/infrastructure/db/drizzle-occurrence-repository';
import { DrizzleRecurringPaymentRepository } from '../../src/recurring/infrastructure/db/drizzle-recurring-payment-repository';
import { eraseUserRecurring } from '../../src/recurring/infrastructure/db/erase-user-recurring';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { writeScope } from '../movements/db-fixtures';
import { newRecurringOwner, rentOf } from './fixtures';

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
const paymentsOf = (ownerId: string) =>
  count('select count(*) as n from recurring_payments where owner_id = $1', [ownerId]);
const occurrencesOf = (ownerId: string) =>
  count('select count(*) as n from recurring_occurrences where owner_id = $1', [ownerId]);
const usersWith = (id: string) => count('select count(*) as n from users where id = $1', [id]);

async function userWithPayment(): Promise<string> {
  const owner = await newRecurringOwner(connection.db, connection.pool);
  const payment = await new DrizzleRecurringPaymentRepository(connection.db).create(
    await writeScope(owner.ownerId),
    rentOf(owner),
  );
  await new DrizzleOccurrenceRepository(connection.db).insertIgnore([
    { paymentId: payment.id, ownerId: owner.ownerId, dueDate: '2026-10-05' },
  ]);
  return owner.ownerId;
}

const erase = (
  userId: string,
  steps: ConstructorParameters<typeof DrizzleUserDeletionRepository>[1],
) =>
  new DrizzleUserDeletionRepository(connection.db, steps).erase({ userId, credentialsVersion: 0 });

describe('eraseUserRecurring', () => {
  it("deletes only the user's payments and occurrences (AC-17)", async () => {
    const ana = await userWithPayment();
    const bea = await userWithPayment();

    await connection.db.transaction((tx) => eraseUserRecurring(tx, ana));

    expect(await paymentsOf(ana)).toBe(0);
    expect(await occurrencesOf(ana)).toBe(0);
    expect(await paymentsOf(bea)).toBe(1);
    expect(await occurrencesOf(bea)).toBe(1);
  });

  it('lets a user with a payment be erased when registered before the movements step', async () => {
    const ana = await userWithPayment();

    await erase(ana, [eraseUserRecurring, eraseUserMovements]);

    expect(await usersWith(ana)).toBe(0);
    expect(await paymentsOf(ana)).toBe(0);
  });

  it('is needed because the restricting keys refuse to delete the accounts first (sad path)', async () => {
    const ana = await userWithPayment();

    await expect(
      connection.pool.query('delete from accounts where owner_id = $1', [ana]),
    ).rejects.toMatchObject({ code: '23503' });
    expect(await paymentsOf(ana)).toBe(1);

    await connection.db.transaction((tx) => eraseUserRecurring(tx, ana));
    await connection.pool.query('delete from accounts where owner_id = $1', [ana]);
    expect(await count('select count(*) as n from accounts where owner_id = $1', [ana])).toBe(0);
  });
});
