import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PushOutcome, PushProvider } from '../../src/push/application/ports/push-provider';
import { PushJob } from '../../src/push/infrastructure/jobs/push-job';
import { createPushJob, createPushProvider } from '../../src/push/jobs';
import { FakePushProvider } from '../../src/push/infrastructure/providers/fake-push-provider';
import { WebPushProvider } from '../../src/push/infrastructure/providers/web-push-provider';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger, type Logger } from '../../src/shared/logging/logger';
import { testDatabaseUrl } from '../helpers/test-database';
import { delivery, deliveryRow, newUser, notice, NOW, subscribe } from './delivery-fixtures';

let connection: DatabaseConnection;
beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});
afterAll(async () => {
  await connection.pool.end();
});
afterEach(() => {
  vi.useRealTimers();
});

interface Line {
  obj: Record<string, unknown>;
}

function captureLogger(): { logger: Logger; lines: Line[] } {
  const lines: Line[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: {
      write: (chunk: string) => {
        lines.push({ obj: JSON.parse(chunk) as Record<string, unknown> });
      },
    },
  });
  return { logger, lines };
}

const BASE = new Date('2026-10-12T09:00:00.000Z');

async function insertNotice(ownerId: string, createdAt: Date, kind = 'reminder'): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    `insert into notices (owner_id, kind, payment_id, due_date, text, created_at)
     values ($1, $2, $3, '2026-10-12', 'Luz vence hoy', $4) returning id`,
    [ownerId, kind, randomUUID(), createdAt],
  );
  return result.rows[0]?.id ?? '';
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Infinity;
}

const failing: PushProvider = {
  send: (): Promise<PushOutcome> =>
    Promise.resolve({ kind: 'retry', status: 503, retryAfterSeconds: null }),
};

describe('PushJob hand-over time (NFR-01)', () => {
  it('hands 100 notices created at random offsets to the provider with p95 under 30 s and max under 5 min', async () => {
    const userId = await newUser(connection);
    await subscribe(connection, userId);
    const provider = new FakePushProvider();
    let clock = BASE;
    const job = createPushJob({
      db: connection.db,
      logger: captureLogger().logger,
      provider,
      intervalSeconds: 10,
      clock: { now: () => clock },
    });

    const created = new Map<string, number>();
    const offsets = Array.from({ length: 100 }, () => Math.floor(Math.random() * 600_000));
    const handOver: number[] = [];
    for (let step = 0; step <= 62; step += 1) {
      clock = new Date(BASE.getTime() + step * 10_000);
      const sentBefore = provider.sent.length;
      for (const offset of offsets) {
        const at = BASE.getTime() + offset;
        if (at > clock.getTime() - 10_000 && at <= clock.getTime() && step > 0) {
          const id = await insertNotice(userId, new Date(at));
          created.set(id.replaceAll('-', ''), at);
        }
      }
      await job.runOnce();
      for (const message of provider.sent.slice(sentBefore)) {
        const at = created.get(message.topic);
        if (at !== undefined) handOver.push(clock.getTime() - at);
      }
    }
    expect(handOver).toHaveLength(100);
    expect(percentile(handOver, 95)).toBeLessThan(30_000);
    expect(Math.max(...handOver)).toBeLessThan(300_000);
  });

  it('hands a reminder created at 09:10 to the provider before 09:15', async () => {
    const userId = await newUser(connection);
    await subscribe(connection, userId);
    const provider = new FakePushProvider();
    let clock = BASE;
    const job = createPushJob({
      db: connection.db,
      logger: captureLogger().logger,
      provider,
      intervalSeconds: 10,
      clock: { now: () => clock },
    });
    const reminderAt = new Date('2026-10-12T09:10:00.000Z');
    let sentAt: Date | undefined;
    for (let step = 0; step <= 90 && !sentAt; step += 1) {
      clock = new Date(BASE.getTime() + step * 10_000);
      if (clock.getTime() === reminderAt.getTime()) await insertNotice(userId, reminderAt);
      await job.runOnce();
      if (provider.sent.length > 0) sentAt = clock;
    }
    expect(sentAt).toBeDefined();
    expect(sentAt?.getTime()).toBeLessThan(new Date('2026-10-12T09:15:00.000Z').getTime());
    expect(sentAt?.getTime()).toBeGreaterThanOrEqual(reminderAt.getTime());
  });
});

describe('PushJob with a provider that fails every send (AC-38)', () => {
  it('keeps running, keeps creating notices and leaves the unread count right', async () => {
    const userId = await newUser(connection);
    await subscribe(connection, userId);
    let clock = BASE;
    const { logger } = captureLogger();
    const job = createPushJob({
      db: connection.db,
      logger,
      provider: failing,
      intervalSeconds: 10,
      clock: { now: () => clock },
    });
    for (let pass = 0; pass < 4; pass += 1) {
      await insertNotice(userId, new Date(clock.getTime() - 1000));
      await expect(job.runOnce()).resolves.toBeUndefined();
      clock = new Date(clock.getTime() + 10_000);
    }
    const unread = await connection.pool.query<{ count: string }>(
      'select count(*) from notices where owner_id = $1 and read_at is null',
      [userId],
    );
    expect(Number(unread.rows[0]?.count)).toBe(4);
    const pending = await connection.pool.query<{ count: string }>(
      "select count(*) from push_deliveries where status = 'pending'",
    );
    expect(Number(pending.rows[0]?.count)).toBe(4);
  });
});

describe('PushJob purge (AC-40)', () => {
  it('deletes finished deliveries last updated 7 days ago and keeps newer ones, the notice stays', async () => {
    const userId = await newUser(connection);
    const sub = await subscribe(connection, userId);
    const oldNotice = await notice(connection, userId);
    const newNotice = await notice(connection, userId);
    const oldDelivery = await delivery(connection, oldNotice, sub.id);
    const newDelivery = await delivery(connection, newNotice, sub.id);
    const day = 86_400_000;
    await connection.pool.query(
      "update push_deliveries set status = 'sent', updated_at = $2 where id = $1",
      [oldDelivery, new Date(NOW.getTime() - 7 * day - 60_000)],
    );
    await connection.pool.query(
      "update push_deliveries set status = 'failed', updated_at = $2 where id = $1",
      [newDelivery, new Date(NOW.getTime() - 6 * day)],
    );
    const job = createPushJob({
      db: connection.db,
      logger: captureLogger().logger,
      provider: new FakePushProvider(),
      intervalSeconds: 10,
      clock: { now: () => NOW },
    });
    await job.runOnce();
    expect(await deliveryRow(connection, oldDelivery)).toBeUndefined();
    expect(await deliveryRow(connection, newDelivery)).toBeDefined();
    const notices = await connection.pool.query('select id from notices where id = $1', [
      oldNotice,
    ]);
    expect(notices.rowCount).toBe(1);
  });
});

describe('PushJob error isolation (FR-14)', () => {
  const build = (overrides: Partial<ConstructorParameters<typeof PushJob>[0]>) => {
    const { logger, lines } = captureLogger();
    const calls: string[] = [];
    const job = new PushJob({
      fanOut: {
        execute: () => {
          calls.push('fanOut');
          return Promise.resolve({ examined: 0, deliveries: 0 });
        },
      },
      deliver: {
        execute: () => {
          calls.push('deliver');
          return Promise.resolve({ claimed: 0 });
        },
      },
      queue: {
        purgeDone: () => {
          calls.push('purge');
          return Promise.resolve(0);
        },
      },
      clock: { now: () => NOW },
      logger,
      intervalMs: 1000,
      ...overrides,
    });
    return { job, lines, calls };
  };

  it('a failing fan-out is logged by class name and delivery and purge still run', async () => {
    const { job, lines, calls } = build({
      fanOut: { execute: () => Promise.reject(new Error('https://fcm.googleapis.com/secret')) },
    });
    await job.runOnce();
    expect(calls).toEqual(['deliver', 'purge']);
    const error = lines.find((l) => l.obj.level === 50);
    expect(error?.obj.errorClass).toBe('Error');
    expect(JSON.stringify(lines)).not.toContain('fcm.googleapis.com');
  });

  it('a failing purge is logged and retried at the next hourly slot, not every pass', async () => {
    let purges = 0;
    let clock = NOW;
    const { job, lines } = build({
      clock: { now: () => clock },
      queue: {
        purgeDone: () => {
          purges += 1;
          return purges === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(0);
        },
      },
    });
    await job.runOnce();
    expect(lines.some((l) => l.obj.level === 50)).toBe(true);
    clock = new Date(NOW.getTime() + 10_000);
    await job.runOnce();
    expect(purges).toBe(1);
    clock = new Date(NOW.getTime() + 3_600_000);
    await job.runOnce();
    expect(purges).toBe(2);
  });

  it('a pass that throws does not stop the chain, and stop() leaves no timer', async () => {
    vi.useFakeTimers();
    let passes = 0;
    const { job } = build({
      deliver: {
        execute: () => {
          passes += 1;
          return passes === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ claimed: 0 });
        },
      },
    });
    job.start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(passes).toBeGreaterThanOrEqual(2);
    await job.stop();
    await job.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('push provider selection (AC-59)', () => {
  const keys = {
    VAPID_PUBLIC_KEY:
      'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
    VAPID_PRIVATE_KEY: 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls',
    VAPID_SUBJECT: 'mailto:ops@pesly.com.ar',
  };

  it('fake opens no connection and records each send', async () => {
    const provider = createPushProvider({ PUSH_PROVIDER: 'fake' });
    expect(provider).toBeInstanceOf(FakePushProvider);
    await provider.send({
      target: { pushUrl: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'a', auth: 'b' },
      body: new Uint8Array(),
      ttlSeconds: 1,
      topic: 'abc',
      urgency: 'normal',
    });
    expect((provider as FakePushProvider).sent).toHaveLength(1);
  });

  it('webpush builds the real provider from the three settings', () => {
    expect(createPushProvider({ PUSH_PROVIDER: 'webpush', ...keys })).toBeInstanceOf(
      WebPushProvider,
    );
  });

  it.each(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const)(
    'sad path: webpush without %s is refused',
    (missing) => {
      expect(() =>
        createPushProvider({ PUSH_PROVIDER: 'webpush', ...keys, [missing]: undefined }),
      ).toThrow(missing);
    },
  );
});

describe('worker wiring (FR-22)', () => {
  it('starts the job with the configured interval and stops without a pending timer', async () => {
    const job = createPushJob({
      db: connection.db,
      logger: captureLogger().logger,
      provider: new FakePushProvider(),
      intervalSeconds: 1,
    });
    expect(job.intervalMs).toBe(1000);
    const passes = vi.spyOn(job, 'runOnce');
    job.start();
    await job.stop();
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(passes).toHaveBeenCalledTimes(1);
  });

  it('worker.ts builds the provider from PUSH_PROVIDER, starts the job and stops it on shutdown', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../src/worker.ts', import.meta.url), 'utf8');
    expect(source).toContain('createPushProvider(env)');
    expect(source).toContain('pushJob.start()');
    expect(source).toContain('pushJob.stop()');
    expect(source).toContain('env.PUSH_JOB_INTERVAL_SECONDS');
  });
});
