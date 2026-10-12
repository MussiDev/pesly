import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleNoticePublisher } from '../../src/notices/infrastructure/db/drizzle-notice-publisher';
import { FanOutNotices } from '../../src/push/application/fan-out-notices';
import { DrizzlePushFanOut } from '../../src/push/infrastructure/db/drizzle-push-fan-out';
import { FakePushProvider } from '../../src/push/infrastructure/providers/fake-push-provider';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { build, newUser, subscribe } from './delivery-fixtures';

let connection: DatabaseConnection;
beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});
afterAll(async () => {
  await connection.pool.end();
});

describe('push payloads never carry amounts or account names', () => {
  it.each(['es', 'en'] as const)(
    'a payment of 350000.00 on "Galicia" reaches the provider without either (%s)',
    async (language) => {
      const userId = await newUser(connection, language);
      await subscribe(connection, userId);
      const publisher = new DrizzleNoticePublisher(connection.db);
      const today = new Date().toISOString().slice(0, 10);
      for (const kind of ['reminder', 'recorded', 'not_recorded'] as const) {
        await publisher.publish({
          ownerId: userId,
          kind,
          paymentId: randomUUID(),
          paymentName: 'Luz',
          dueDate: today,
          language,
          ...(kind === 'reminder' ? { daysUntilDue: 1 } : {}),
        });
      }
      await new FanOutNotices(new DrizzlePushFanOut(connection.db), {
        now: () => new Date(),
      }).execute();
      const provider = new FakePushProvider();
      await build(connection, provider, { now: () => new Date(Date.now() + 1000) }).execute();
      expect(provider.sent).toHaveLength(3);
      for (const message of provider.sent) {
        const text = new TextDecoder().decode(message.body);
        expect(text).not.toContain('350000');
        expect(text).not.toContain('Galicia');
        expect(text).toContain(`/${language}/notices`);
      }
    },
  );
});
