import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLimiter } from '../../src/push/application/limit-concurrency';
import { FakePushProvider } from '../../src/push/infrastructure/providers/fake-push-provider';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { build, delivery, newUser, notice, subscribe } from './delivery-fixtures';

let connection: DatabaseConnection;
beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});
afterAll(async () => {
  await connection.pool.end();
});

async function seed(count: number): Promise<void> {
  const userId = await newUser(connection);
  const noticeIds: string[] = [];
  for (let i = 0; i < count; i += 1) noticeIds.push(await notice(connection, userId));
  const sub = await subscribe(connection, userId);
  for (const noticeId of noticeIds) await delivery(connection, noticeId, sub.id);
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('limiter', () => {
  it('never runs more than the limit at once and returns each result', async () => {
    const limit = createLimiter(3);
    let active = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        limit(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await pause(5);
          active -= 1;
          return i;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('keeps going after a task rejects', async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(limit(() => Promise.resolve(1))).resolves.toBe(1);
  });
});

describe('delivery concurrency', () => {
  it('two instances claiming at the same time send each delivery once', async () => {
    await seed(40);
    const provider = new FakePushProvider();
    provider.delayMs = 5;
    await Promise.all([
      build(connection, provider).execute(),
      build(connection, provider).execute(),
    ]);
    const topics = provider.sent.map((m) => m.topic);
    expect(topics).toHaveLength(40);
    expect(new Set(topics).size).toBe(40);
  });

  it('keeps at most 20 sends in flight with 60 due deliveries and a provider that never answers', async () => {
    await seed(60);
    const provider = new FakePushProvider();
    let inFlight = 0;
    let peak = 0;
    const release: (() => void)[] = [];
    provider.send = async (message) => {
      provider.sent.push(message);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => release.push(resolve));
      inFlight -= 1;
      return { kind: 'accepted' };
    };
    const pass = build(connection, provider).execute();
    for (let i = 0; i < 100 && provider.sent.length < 20; i += 1) await pause(10);
    await pause(50);
    expect(peak).toBe(20);
    expect(provider.sent).toHaveLength(20);
    while (provider.sent.length < 60 || release.length > 0) {
      for (const resolve of release.splice(0)) resolve();
      await pause(5);
    }
    await pass;
    expect(peak).toBe(20);
    expect(provider.sent).toHaveLength(60);
  });
});
