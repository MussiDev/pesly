import { createECDH, randomBytes, randomUUID } from 'node:crypto';
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

async function seedSubscriptionWithDelivery(userId: string): Promise<string> {
  const sub = await connection.pool.query<{ id: string }>(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
     values ($1, $2, $3, $4) returning id`,
    [
      userId,
      `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      createECDH('prime256v1').generateKeys().toString('base64url'),
      randomBytes(16).toString('base64url'),
    ],
  );
  const subscriptionId = sub.rows[0]?.id ?? '';
  const notice = await connection.pool.query<{ id: string }>(
    `insert into notices (owner_id, kind, payment_id, due_date, text)
     values ($1, 'reminder', gen_random_uuid(), '2026-10-05', 'x') returning id`,
    [userId],
  );
  await connection.pool.query(
    'insert into push_deliveries (notice_id, subscription_id) values ($1, $2)',
    [notice.rows[0]?.id, subscriptionId],
  );
  return subscriptionId;
}

const count = async (table: string, column: string, value: string) =>
  Number(
    (
      await connection.pool.query<{ n: string }>(
        `select count(*) as n from ${table} where ${column} = $1`,
        [value],
      )
    ).rows[0]?.n,
  );

describe('account deletion', () => {
  it("removes the user's subscriptions and deliveries and leaves other users' (AC-10)", async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const suffix = Date.now();
    const anaEmail = `ana-${suffix}@push-erasure.test`;
    const ana = await seedUser(connection, { email: anaEmail, password: PASSWORD });
    const bob = await seedUser(connection, {
      email: `bob-${suffix}@push-erasure.test`,
      password: PASSWORD,
    });
    const anaSub = await seedSubscriptionWithDelivery(ana);
    const bobSub = await seedSubscriptionWithDelivery(bob);
    const cookies = sessionFrom(await signIn(harness.app, anaEmail, PASSWORD));

    const response = await deleteAccount(harness.app, cookies, { body: { password: PASSWORD } });

    expect(response.status).toBe(204);
    expect(await count('push_subscriptions', 'user_id', ana)).toBe(0);
    expect(await count('push_deliveries', 'subscription_id', anaSub)).toBe(0);
    expect(await count('push_subscriptions', 'user_id', bob)).toBe(1);
    expect(await count('push_deliveries', 'subscription_id', bobSub)).toBe(1);
  });
});
