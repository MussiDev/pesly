import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPushJob } from '../../src/push/jobs';
import { FakePushProvider } from '../../src/push/infrastructure/providers/fake-push-provider';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { testDatabaseUrl } from '../helpers/test-database';
import { newUser, NOW, subscribe } from './delivery-fixtures';

let connection: DatabaseConnection;
beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});
afterAll(async () => {
  await connection.pool.end();
});

describe('two worker instances (NFR-03)', () => {
  it('running the whole job over the same notices send each notice to each device once', async () => {
    const userId = await newUser(connection);
    await subscribe(connection, userId);
    await subscribe(connection, userId);
    for (let i = 0; i < 30; i += 1) {
      await connection.pool.query(
        `insert into notices (owner_id, kind, payment_id, due_date, text, created_at)
         values ($1, 'reminder', $2, '2026-10-15', 'Luz vence manana', $3)`,
        [userId, randomUUID(), new Date(NOW.getTime() - 60_000)],
      );
    }
    const make = (provider: FakePushProvider) =>
      createPushJob({
        db: connection.db,
        logger: createLogger({ level: 'error', destination: { write: () => undefined } }),
        provider,
        intervalSeconds: 10,
        clock: { now: () => NOW },
      });
    const a = new FakePushProvider();
    const b = new FakePushProvider();
    a.delayMs = 2;
    b.delayMs = 2;
    await Promise.all([make(a).runOnce(), make(b).runOnce()]);
    await Promise.all([make(a).runOnce(), make(b).runOnce()]);
    const sent = [...a.sent, ...b.sent].map((m) => `${m.target.pushUrl}|${m.topic}`);
    expect(sent).toHaveLength(60);
    expect(new Set(sent).size).toBe(60);
  });
});
