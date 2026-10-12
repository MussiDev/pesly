import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPushJob } from '../../src/push/jobs';
import { FakePushProvider } from '../../src/push/infrastructure/providers/fake-push-provider';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUser, NOW, subscribe } from '../push/delivery-fixtures';

/** NFR-02 benchmark: one pass over 5,000 due deliveries with the fake provider. */

const DELIVERIES = 5000;
const MAX_PASS_MS = 60_000;

let connection: DatabaseConnection;
beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});
afterAll(async () => {
  await connection.pool.end();
});

describe('push delivery pass (NFR-02)', () => {
  it('fans out and delivers 5,000 due deliveries in under 60 s', async () => {
    const userId = await newUser(connection);
    const sub = await subscribe(connection, userId);
    await connection.pool.query(
      `insert into notices (owner_id, kind, payment_id, due_date, text, created_at, push_handled_at)
       select $1, 'reminder', gen_random_uuid(), '2026-10-15', 'Luz vence manana', $2, $2
       from generate_series(1, $3)`,
      [userId, new Date(NOW.getTime() - 60_000), DELIVERIES],
    );
    await connection.pool.query(
      `insert into push_deliveries (notice_id, subscription_id, next_attempt_at)
       select id, $1, $2 from notices`,
      [sub.id, new Date(NOW.getTime() - 1000)],
    );
    const provider = new FakePushProvider();
    const job = createPushJob({
      db: connection.db,
      logger: createLogger({ level: 'error', destination: { write: () => undefined } }),
      provider,
      intervalSeconds: 10,
      clock: { now: () => NOW },
    });

    const start = performance.now();
    await job.runOnce();
    const elapsed = performance.now() - start;
    console.log(`push delivery pass: ${DELIVERIES} deliveries in ${Math.round(elapsed)} ms`);

    expect(provider.sent).toHaveLength(DELIVERIES);
    expect(elapsed).toBeLessThan(MAX_PASS_MS);
    // Above the 60 s budget, so a slow pass fails on the assertion and not on the default 5 s.
  }, 120_000);
});
