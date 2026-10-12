import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzlePushDeliveryQueue } from '../../src/push/infrastructure/db/drizzle-push-delivery-queue';
import { FakePushProvider } from '../../src/push/infrastructure/providers/fake-push-provider';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  build,
  delivery,
  deliveryRow,
  newUser,
  notice,
  NOW,
  subscribe,
  type LogLine,
} from './delivery-fixtures';

let connection: DatabaseConnection;
beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});
afterAll(async () => {
  await connection.pool.end();
});

async function one(options: { read?: boolean; kind?: string } = {}) {
  const userId = await newUser(connection);
  const sub = await subscribe(connection, userId);
  const noticeId = await notice(connection, userId, options);
  const id = await delivery(connection, noticeId, sub.id);
  return { userId, sub, noticeId, id };
}
const at = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1000);

describe('DeliverDuePushes', () => {
  it('marks an accepted delivery sent with the sending time and does not resend it', async () => {
    const { id } = await one();
    const provider = new FakePushProvider();
    const run = build(connection, provider);
    await run.execute();
    await run.execute();
    await run.execute();
    const row = await deliveryRow(connection, id);
    expect(row?.status).toBe('sent');
    expect(row?.sent_at?.toISOString()).toBe(NOW.toISOString());
    expect(provider.sent).toHaveLength(1);
  });

  it('sends one push to each device of the user with ttl 21600 and the notice id as topic', async () => {
    const userId = await newUser(connection);
    const a = await subscribe(connection, userId);
    const b = await subscribe(connection, userId);
    const noticeId = await notice(connection, userId);
    await delivery(connection, noticeId, a.id);
    await delivery(connection, noticeId, b.id);
    const provider = new FakePushProvider();
    await build(connection, provider).execute();
    expect(provider.sent.map((m) => m.target.pushUrl).sort()).toEqual(
      [a.endpoint, b.endpoint].sort(),
    );
    for (const message of provider.sent) {
      expect(message.ttlSeconds).toBe(21600);
      expect(message.topic).toBe(noticeId.replaceAll('-', ''));
      expect(message.urgency).toBe('normal');
    }
  });

  it('skips a delivery whose notice was read, sending nothing', async () => {
    const { id } = await one({ read: true });
    const provider = new FakePushProvider();
    await build(connection, provider).execute();
    expect((await deliveryRow(connection, id))?.status).toBe('skipped');
    expect(provider.sent).toHaveLength(0);
  });

  it('skips a budget alert and a subscription that belongs to someone else', async () => {
    const budget = await one({ kind: 'budget_alert' });
    const owner = await newUser(connection);
    const other = await newUser(connection);
    const foreign = await subscribe(connection, other);
    const noticeId = await notice(connection, owner);
    const foreignId = await delivery(connection, noticeId, foreign.id);
    const provider = new FakePushProvider();
    await build(connection, provider).execute();
    expect((await deliveryRow(connection, budget.id))?.status).toBe('skipped');
    expect((await deliveryRow(connection, foreignId))?.status).toBe('skipped');
    expect(provider.sent).toHaveLength(0);
  });

  it('deletes the subscription on gone and still pushes the other device', async () => {
    const userId = await newUser(connection);
    const a = await subscribe(connection, userId);
    const b = await subscribe(connection, userId);
    const noticeId = await notice(connection, userId);
    const idA = await delivery(connection, noticeId, a.id);
    const idB = await delivery(connection, noticeId, b.id);
    const provider = new FakePushProvider();
    provider.script(a.endpoint, [{ kind: 'gone' }]);
    await build(connection, provider).execute();
    expect(await deliveryRow(connection, idA)).toBeUndefined();
    expect((await deliveryRow(connection, idB))?.status).toBe('sent');
    const kept = await connection.pool.query('select 1 from notices where id = $1', [noticeId]);
    expect(kept.rowCount).toBe(1);
    const subs = await connection.pool.query('select id from push_subscriptions where id = $1', [
      a.id,
    ]);
    expect(subs.rowCount).toBe(0);
  });

  it.each([400, 401, 403, 413])(
    'marks %i failed with no retry, keeps the subscription and logs the status',
    async (status) => {
      const { id, sub, noticeId } = await one();
      const provider = new FakePushProvider();
      provider.script(sub.endpoint, [{ kind: 'rejected', status }]);
      const lines: LogLine[] = [];
      const run = build(connection, provider, { lines });
      await run.execute();
      await run.execute();
      expect((await deliveryRow(connection, id))?.status).toBe('failed');
      expect(provider.sent).toHaveLength(1);
      const subs = await connection.pool.query('select 1 from push_subscriptions where id = $1', [
        sub.id,
      ]);
      expect(subs.rowCount).toBe(1);
      expect(lines.some((l) => l.fields.status === status && l.fields.noticeId === noticeId)).toBe(
        true,
      );
    },
  );

  it('retries at 30, 90, 210 and 450 seconds and fails on the fifth attempt', async () => {
    const { id, sub } = await one();
    const provider = new FakePushProvider();
    provider.script(
      sub.endpoint,
      Array.from({ length: 6 }, () => ({
        kind: 'retry' as const,
        status: 503,
        retryAfterSeconds: null,
      })),
    );
    const lines: LogLine[] = [];
    let now = NOW;
    const run = build(connection, provider, { now: () => now, lines });
    for (const wait of [30, 90, 210, 450]) {
      await run.execute();
      const row = await deliveryRow(connection, id);
      expect(row?.status).toBe('pending');
      expect(row?.lease_until).toBeNull();
      expect(row?.next_attempt_at.getTime()).toBe(now.getTime() + wait * 1000);
      await run.execute(); // not due yet: nothing is sent
      now = row?.next_attempt_at ?? now;
    }
    await run.execute();
    expect((await deliveryRow(connection, id))?.status).toBe('failed');
    expect((await deliveryRow(connection, id))?.attempts).toBe(5);
    await run.execute();
    expect(provider.sent).toHaveLength(5);
    expect(lines.some((l) => l.level === 'error' || l.level === 'warn')).toBe(true);
  });

  it('waits at least Retry-After and caps the wait at 900 seconds', async () => {
    const a = await one();
    const b = await one();
    const provider = new FakePushProvider();
    provider.script(a.sub.endpoint, [{ kind: 'retry', status: 429, retryAfterSeconds: 100 }]);
    provider.script(b.sub.endpoint, [{ kind: 'retry', status: 429, retryAfterSeconds: 5000 }]);
    await build(connection, provider).execute();
    expect((await deliveryRow(connection, a.id))?.next_attempt_at.getTime()).toBe(
      at(100).getTime(),
    );
    expect((await deliveryRow(connection, b.id))?.next_attempt_at.getTime()).toBe(
      at(900).getTime(),
    );
  });

  it('retries only the failing device', async () => {
    const userId = await newUser(connection);
    const a = await subscribe(connection, userId);
    const b = await subscribe(connection, userId);
    const noticeId = await notice(connection, userId);
    const idA = await delivery(connection, noticeId, a.id);
    const idB = await delivery(connection, noticeId, b.id);
    const provider = new FakePushProvider();
    provider.script(a.endpoint, [{ kind: 'retry', status: 503, retryAfterSeconds: null }]);
    let now = NOW;
    const run = build(connection, provider, { now: () => now });
    await run.execute();
    now = at(31);
    await run.execute();
    expect((await deliveryRow(connection, idA))?.status).toBe('sent');
    expect((await deliveryRow(connection, idB))?.status).toBe('sent');
    expect(provider.sent.filter((m) => m.target.pushUrl === b.endpoint)).toHaveLength(1);
    expect(provider.sent.filter((m) => m.target.pushUrl === a.endpoint)).toHaveLength(2);
  });

  it('loses no delivery when the provider is unreachable for every device', async () => {
    const rows = [await one(), await one()];
    const provider = new FakePushProvider();
    for (const r of rows) {
      provider.script(r.sub.endpoint, [{ kind: 'retry', status: null, retryAfterSeconds: null }]);
    }
    await build(connection, provider).execute();
    for (const r of rows) {
      expect((await deliveryRow(connection, r.id))?.status).toBe('pending');
      const read = await connection.pool.query<{ read_at: Date | null }>(
        'select read_at from notices where id = $1',
        [r.noticeId],
      );
      expect(read.rows[0]?.read_at).toBeNull();
    }
  });

  it('logs the delivery id, notice id and status and nothing about the device or text', async () => {
    const { id, sub, noticeId } = await one();
    const provider = new FakePushProvider();
    provider.script(sub.endpoint, [{ kind: 'rejected', status: 403 }]);
    const lines: LogLine[] = [];
    await build(connection, provider, { lines }).execute();
    const dump = JSON.stringify(lines);
    expect(dump).toContain(id);
    expect(dump).toContain(noticeId);
    expect(dump).not.toContain(sub.endpoint);
    expect(dump).not.toContain('Luz');
    const failed = lines.find((l) => l.fields.status === 403);
    expect(Object.keys(failed?.fields ?? {}).sort()).toEqual(['deliveryId', 'noticeId', 'status']);
  });

  it('keeps going when one row throws and leaves that row to its lease', async () => {
    const bad = await one();
    const good = await one();
    const provider = new FakePushProvider();
    const original = provider.send.bind(provider);
    provider.send = async (message) => {
      if (message.target.pushUrl === bad.sub.endpoint) throw new Error(bad.sub.endpoint);
      return original(message);
    };
    const lines: LogLine[] = [];
    await build(connection, provider, { lines }).execute();
    expect((await deliveryRow(connection, good.id))?.status).toBe('sent');
    const row = await deliveryRow(connection, bad.id);
    expect(row?.status).toBe('pending');
    expect(row?.lease_until?.getTime()).toBe(at(120).getTime());
    expect(JSON.stringify(lines)).not.toContain(bad.sub.endpoint);
  });
});

describe('claim lease', () => {
  it('does not claim a leased delivery before 2 minutes and claims it afterwards', async () => {
    const { id } = await one();
    const queue = new DrizzlePushDeliveryQueue(connection.db);
    expect(await queue.claimDue(NOW, 100)).toHaveLength(1);
    expect(await queue.claimDue(at(119), 100)).toHaveLength(0);
    const again = await queue.claimDue(at(120), 100);
    expect(again.map((r) => r.id)).toEqual([id]);
    expect(again[0]?.attempts).toBe(2);
  });

  it('honours the limit', async () => {
    await one();
    await one();
    await one();
    const queue = new DrizzlePushDeliveryQueue(connection.db);
    expect(await queue.claimDue(NOW, 2)).toHaveLength(2);
    expect(await queue.claimDue(NOW, 2)).toHaveLength(1);
  });

  it('fails an exhausted delivery whose lease passed instead of claiming a sixth time', async () => {
    const { id } = await one();
    await connection.pool.query(
      `update push_deliveries set attempts = 5, lease_until = $2 where id = $1`,
      [id, NOW],
    );
    const queue = new DrizzlePushDeliveryQueue(connection.db);
    expect(await queue.claimDue(at(1), 100)).toHaveLength(0);
    expect((await deliveryRow(connection, id))?.status).toBe('failed');
  });
});

describe('guarded marks and purge', () => {
  it('a duplicate mark on a sent delivery changes nothing and an invalid status is rejected', async () => {
    const { id } = await one();
    const queue = new DrizzlePushDeliveryQueue(connection.db);
    expect(await queue.mark(id, 'sent', NOW)).toBe(true);
    expect(await queue.mark(id, 'failed', at(60))).toBe(false);
    expect(await queue.reschedule(id, at(500), at(60))).toBe(false);
    const row = await deliveryRow(connection, id);
    expect(row?.status).toBe('sent');
    expect(row?.sent_at?.toISOString()).toBe(NOW.toISOString());
    await expect(queue.mark(id, 'pending' as never, NOW)).rejects.toThrow();
  });

  it('purges finished deliveries older than the cutoff and keeps pending and recent ones', async () => {
    const old = await one();
    const recent = await one();
    const pending = await one();
    await connection.pool.query(
      `update push_deliveries set status = 'sent', updated_at = $2 where id = $1`,
      [old.id, new Date(NOW.getTime() - 8 * 86_400_000)],
    );
    await connection.pool.query(
      `update push_deliveries set status = 'failed', updated_at = $2 where id = $1`,
      [recent.id, new Date(NOW.getTime() - 6 * 86_400_000)],
    );
    await connection.pool.query(`update push_deliveries set updated_at = $2 where id = $1`, [
      pending.id,
      new Date(NOW.getTime() - 30 * 86_400_000),
    ]);
    const queue = new DrizzlePushDeliveryQueue(connection.db);
    await queue.purgeDone(new Date(NOW.getTime() - 7 * 86_400_000));
    expect(await deliveryRow(connection, old.id)).toBeUndefined();
    expect(await deliveryRow(connection, recent.id)).toBeDefined();
    expect(await deliveryRow(connection, pending.id)).toBeDefined();
  });
});
