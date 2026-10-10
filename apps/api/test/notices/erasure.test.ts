import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createIdentityHarness } from '../helpers/identity-harness';
import { deleteAccount, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';

const noticesOf = async (ownerId: string): Promise<number> =>
  Number(
    (
      await connection.pool.query<{ n: string }>(
        'select count(*) as n from notices where owner_id = $1',
        [ownerId],
      )
    ).rows[0]?.n,
  );

async function seedNotices(ownerId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await connection.pool.query(
      `insert into notices (owner_id, kind, payment_id, due_date, text)
       values ($1, 'reminder', gen_random_uuid(), '2026-10-05', $2)`,
      [ownerId, `n-${i}`],
    );
  }
}

describe('account deletion', () => {
  it("removes all the user's notices through the owner cascade and leaves other users' (AC-30)", async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const suffix = Date.now();
    const anaEmail = `ana-${suffix}@notices-erasure.test`;
    const bobEmail = `bob-${suffix}@notices-erasure.test`;
    const ana = await seedUser(connection, { email: anaEmail, password: PASSWORD });
    const bob = await seedUser(connection, { email: bobEmail, password: PASSWORD });
    await seedNotices(ana, 3);
    await seedNotices(bob, 2);
    const cookies = sessionFrom(await signIn(harness.app, anaEmail, PASSWORD));

    const response = await deleteAccount(harness.app, cookies, { body: { password: PASSWORD } });

    expect(response.status).toBe(204);
    expect(await noticesOf(ana)).toBe(0);
    expect(await noticesOf(bob)).toBe(2);
  });
});
