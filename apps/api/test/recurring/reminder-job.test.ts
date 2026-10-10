import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createNoticePublisher } from '../../src/notices';
import type { ReminderSummary } from '../../src/recurring/application/create-due-reminders';
import { DrizzleRecurringPaymentRepository } from '../../src/recurring/infrastructure/db/drizzle-recurring-payment-repository';
import { ReminderJob, ReminderLog } from '../../src/recurring/infrastructure/jobs/reminder-job';
import { createRecurringJobs, createReminderJob } from '../../src/recurring/jobs';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger, type Logger } from '../../src/shared/logging/logger';
import { MutableClock } from '../fakes/mutable-clock';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newUserId, writeScope } from '../movements/db-fixtures';
import { rentOf } from './fixtures';

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

const INFO = 30;
const ERROR = 50;

interface Line {
  level: number;
  obj: Record<string, unknown>;
}

function captureLogger(): { logger: Logger; lines: Line[] } {
  const lines: Line[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: {
      write: (chunk: string) => {
        const obj = JSON.parse(chunk) as Record<string, unknown>;
        lines.push({ level: obj.level as number, obj });
      },
    },
  });
  return { logger, lines };
}

const emptySummary: ReminderSummary = { payments: 0, reminders: 0, failed: 0 };

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function stubJob(execute: () => Promise<ReminderSummary>, intervalMs = 60_000) {
  const { logger, lines } = captureLogger();
  return { job: new ReminderJob({ execute, logger, intervalMs }), lines };
}

/** Rent due on the 5th of October 2026 asking for confirmation, 3 reminder days, old enough. */
async function rentWithReminder() {
  const ownerId = await newUserId(connection.db);
  const owner = {
    ownerId,
    accountId: await newAccount(connection.pool, ownerId),
    categoryId: await newCategory(connection.pool, ownerId, 'expense'),
  };
  const payment = await new DrizzleRecurringPaymentRepository(connection.db).create(
    await writeScope(ownerId),
    rentOf(owner, {
      name: 'Luz',
      startDate: '2026-09-01',
      scheduleFrom: '2026-09-01',
      autoRecordingFrom: '2026-09-01',
    }),
  );
  return { owner, payment };
}

function dependenciesFor(clock: MutableClock, intervalSeconds = 60) {
  const { logger } = captureLogger();
  return {
    db: connection.db,
    logger,
    recorder: {
      record: () => Promise.reject(new Error('the reminder pass never records')),
      recordOnce: () => Promise.reject(new Error('the reminder pass never records')),
    },
    notices: createNoticePublisher(connection.db),
    clock,
    intervalSeconds,
  };
}

const noticesOf = async (paymentId: string) =>
  (
    await connection.pool.query<{ kind: string; due_date: string; text: string; read_at: null }>(
      'select kind, due_date::text as due_date, text, read_at from notices where payment_id = $1',
      [paymentId],
    )
  ).rows;

describe('ReminderJob scheduling', () => {
  it('a pass that throws does not stop the job; stop() twice is harmless (AC-25)', async () => {
    vi.useFakeTimers();
    const execute = vi
      .fn<() => Promise<ReminderSummary>>()
      .mockRejectedValueOnce(new Error('connection terminated'))
      .mockResolvedValue(emptySummary);
    const { job, lines } = stubJob(execute);

    job.start();
    await flush();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(lines.filter((line) => line.level === ERROR)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(execute).toHaveBeenCalledTimes(2);

    await job.stop();
    await job.stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('waits the interval after a pass and never overlaps passes', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    let active = 0;
    let maxActive = 0;
    const execute = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      active--;
      return emptySummary;
    });
    const { job } = stubJob(execute, 1_000);

    job.start();
    job.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(execute).toHaveBeenCalledTimes(1);
    release?.();
    await vi.advanceTimersByTimeAsync(999);
    expect(execute).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    release?.();
    await job.stop();
  });

  it('sad path: shutdown during a pass waits for the pass and then closes', async () => {
    let release: (() => void) | undefined;
    const events: string[] = [];
    const execute = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      events.push('pass finished');
      return emptySummary;
    });
    const { job } = stubJob(execute);
    job.start();
    await flush();

    const stopping = job.stop().then(() => events.push('stopped'));
    await flush();
    expect(events).toEqual([]);
    release?.();
    await stopping;

    expect(events).toEqual(['pass finished', 'stopped']);
  });

  it('logs a pass that created reminders at info level and an idle one at debug', async () => {
    const created = stubJob(() => Promise.resolve({ payments: 3, reminders: 2, failed: 0 }));
    await created.job.runOnce();
    expect(created.lines.find((line) => line.level === INFO)?.obj).toMatchObject({ reminders: 2 });

    const idle = stubJob(() => Promise.resolve(emptySummary));
    await idle.job.runOnce();
    expect(idle.lines.some((line) => line.level === INFO)).toBe(false);
  });
});

describe('ReminderLog', () => {
  it('logs a repeated failure once, with identifiers and the class name only', () => {
    const { logger, lines } = captureLogger();
    const log = new ReminderLog(logger);

    log.report({ paymentId: 'p1', afterId: null, errorName: 'TypeError' });
    log.report({ paymentId: 'p1', afterId: null, errorName: 'TypeError' });
    log.report({ paymentId: null, afterId: 'p0', errorName: 'Error' });

    const errors = lines.filter((line) => line.level === ERROR);
    expect(errors).toHaveLength(2);
    expect(errors[0]?.obj).toMatchObject({ paymentId: 'p1', errorName: 'TypeError' });
  });
});

describe('createReminderJob on the real database', () => {
  it('creates the reminder at 09:00 owner time and not before, with a 60 s interval', async () => {
    const { payment } = await rentWithReminder();
    // America/Cordoba is UTC-3: the reminder day is 2026-10-02, 12:00 UTC is 09:00 local.
    const clock = new MutableClock(new Date('2026-10-02T11:59:00.000Z'));
    const job = createReminderJob(dependenciesFor(clock));
    expect(job.intervalMs).toBe(60_000);

    await job.runOnce();
    expect(await noticesOf(payment.id)).toEqual([]);

    clock.advance(60_000);
    await job.runOnce();

    expect(await noticesOf(payment.id)).toEqual([
      { kind: 'reminder', due_date: '2026-10-05', text: 'Luz vence en 3 días', read_at: null },
    ]);
  });

  it('three passes over the same reminder hold one notice (AC-23)', async () => {
    const { payment } = await rentWithReminder();
    const clock = new MutableClock(new Date('2026-10-02T15:00:00.000Z'));
    const job = createReminderJob(dependenciesFor(clock));

    await job.runOnce();
    await job.runOnce();
    await job.runOnce();

    expect(await noticesOf(payment.id)).toHaveLength(1);
  });

  it('two concurrent passes over the same reminder hold one notice (AC-24)', async () => {
    const { payment } = await rentWithReminder();
    const clock = new MutableClock(new Date('2026-10-02T15:00:00.000Z'));

    await Promise.all([
      createReminderJob(dependenciesFor(clock)).runOnce(),
      createReminderJob(dependenciesFor(clock)).runOnce(),
    ]);

    expect(await noticesOf(payment.id)).toHaveLength(1);
  });

  it('a reminder is not created for an occurrence already confirmed', async () => {
    const { owner, payment } = await rentWithReminder();
    await connection.pool.query(
      `insert into recurring_occurrences (payment_id, owner_id, due_date, status, resolved_at)
       values ($1, $2, '2026-10-05', 'skipped', now())`,
      [payment.id, owner.ownerId],
    );
    const clock = new MutableClock(new Date('2026-10-02T15:00:00.000Z'));

    await createReminderJob(dependenciesFor(clock)).runOnce();

    expect(await noticesOf(payment.id)).toEqual([]);
  });
});

describe('createRecurringJobs', () => {
  it('starts the reminder job next to the recording job and stops both', async () => {
    const { payment } = await rentWithReminder();
    const clock = new MutableClock(new Date('2026-10-02T15:00:00.000Z'));
    const jobs = createRecurringJobs(dependenciesFor(clock, 1));

    jobs.start();
    await vi.waitFor(async () => {
      expect(await noticesOf(payment.id)).toHaveLength(1);
    });
    await jobs.stop();
    await jobs.stop();
  });
});

describe('worker wiring', () => {
  const worker = readFileSync(new URL('../../src/worker.ts', import.meta.url), 'utf8');

  it('injects the notices publisher from the notices module and imports no recurring internals', () => {
    expect(worker).toContain('createNoticePublisher');
    expect(worker).toMatch(/notices:\s*createNoticePublisher\(db\)/);
    expect(worker).not.toMatch(/recurring\/infrastructure/);
  });

  it('the reminder files are scanned by the no-float guard', () => {
    const guard = readFileSync(new URL('./no-float-money.test.ts', import.meta.url), 'utf8');
    for (const file of [
      'application/create-due-reminders.ts',
      'application/ports/reminder-payment-source.ts',
      'infrastructure/db/drizzle-reminder-payment-source.ts',
      'infrastructure/jobs/reminder-job.ts',
    ]) {
      expect(guard).toContain(`apps/api/src/recurring/${file}`);
    }
  });
});
