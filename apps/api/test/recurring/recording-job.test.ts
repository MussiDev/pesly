import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRecurringExpenseRecorder } from '../../src/movements/infrastructure/recurring/drizzle-recurring-expense-recorder';
import type { RecordSummary } from '../../src/recurring/application/record-due-occurrences';
import { DrizzleRecurringPaymentRepository } from '../../src/recurring/infrastructure/db/drizzle-recurring-payment-repository';
import {
  MAX_REPORTED_KEYS,
  RecordingJob,
  RecordingLog,
} from '../../src/recurring/infrastructure/jobs/recording-job';
import { createRecordingJob, createRecurringJobs } from '../../src/recurring/jobs';
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
        lines.push({ level: Number(obj.level), obj });
      },
    },
  });
  return { logger, lines };
}

const emptySummary: RecordSummary = {
  payments: 0,
  recorded: 0,
  skippedAlreadyResolved: 0,
  skippedMissing: 0,
  failed: 0,
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function stubJob(execute: () => Promise<RecordSummary>, intervalMs = 60_000) {
  const { logger, lines } = captureLogger();
  return { job: new RecordingJob({ execute, logger, intervalMs }), lines };
}

/** Rent due on the 5th of October 2026, automatic, recording from its first due date. */
async function dueRent() {
  // Every test starts on truncated tables, so the owner's rate type needs its stored rate here.
  await connection.pool.query(
    `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
     values ('oficial', 13900000, 14000000, now(), now()) on conflict (rate_type) do nothing`,
  );
  const ownerId = await newUserId(connection.db, { rateType: 'oficial' });
  const owner = {
    ownerId,
    accountId: await newAccount(connection.pool, ownerId),
    categoryId: await newCategory(connection.pool, ownerId, 'expense'),
  };
  const payment = await new DrizzleRecurringPaymentRepository(connection.db).create(
    await writeScope(owner.ownerId),
    rentOf(owner, { mode: 'automatic' }),
  );
  return { owner, payment };
}

function dependenciesFor(clock: MutableClock, intervalSeconds = 60) {
  const { logger } = captureLogger();
  return {
    db: connection.db,
    logger,
    recorder: createRecurringExpenseRecorder(connection.db, logger, { clock }),
    clock,
    intervalSeconds,
  };
}

const countMovements = async (ownerId: string): Promise<number> =>
  Number(
    (
      await connection.pool.query<{ n: string }>(
        'select count(*) as n from movements where owner_id = $1',
        [ownerId],
      )
    ).rows[0]?.n,
  );

const statusOf = async (paymentId: string): Promise<string[]> =>
  (
    await connection.pool.query<{ status: string }>(
      'select status from recurring_occurrences where payment_id = $1 order by due_date',
      [paymentId],
    )
  ).rows.map((row) => row.status);

describe('RecordingJob scheduling', () => {
  it('a pass that throws does not stop the job; stop() twice is harmless', async () => {
    vi.useFakeTimers();
    const execute = vi
      .fn<() => Promise<RecordSummary>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(emptySummary);
    const { job, lines } = stubJob(execute);

    job.start();
    await flush();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(lines.some((line) => line.level === ERROR)).toBe(true);

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

  it('sad path: a database failure during a pass is logged and the next interval retries it', async () => {
    vi.useFakeTimers();
    const execute = vi
      .fn<() => Promise<RecordSummary>>()
      .mockRejectedValueOnce(new Error('connection terminated'))
      .mockResolvedValue({ ...emptySummary, recorded: 1 });
    const { job, lines } = stubJob(execute);

    job.start();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(lines.filter((line) => line.level === ERROR)).toHaveLength(1);
    await job.stop();
  });

  it('logs the counts of a pass that recorded something at info level', async () => {
    const { job, lines } = stubJob(() => Promise.resolve({ ...emptySummary, recorded: 2 }));

    await job.runOnce();

    expect(lines.find((line) => line.level === INFO)?.obj).toMatchObject({ recorded: 2 });
  });
});

describe('RecordingLog', () => {
  it('logs a repeated failure once per occurrence and error class, identifiers only', () => {
    const { logger, lines } = captureLogger();
    const log = new RecordingLog(logger);
    const failure = { paymentId: 'p1', occurrenceId: 'o1', errorName: 'AccountArchived' };

    log.report(failure);
    log.report(failure);
    log.report({ ...failure, errorName: 'RateUnavailable' });
    log.report({ ...failure, occurrenceId: 'o2' });

    const errors = lines.filter((line) => line.level === ERROR);
    expect(errors).toHaveLength(3);
    expect(errors[0]?.obj).toMatchObject({
      paymentId: 'p1',
      occurrenceId: 'o1',
      errorName: 'AccountArchived',
    });
  });

  it('bounds the de-duplication set at 10,000 keys, clearing it when full', () => {
    const { logger, lines } = captureLogger();
    const log = new RecordingLog(logger);
    expect(MAX_REPORTED_KEYS).toBe(10_000);
    for (let i = 0; i < MAX_REPORTED_KEYS; i++) {
      log.report({ paymentId: 'p', occurrenceId: `o${i}`, errorName: 'E' });
    }
    expect(log.size).toBe(MAX_REPORTED_KEYS);

    log.report({ paymentId: 'p', occurrenceId: 'o0', errorName: 'E' });
    expect(log.size).toBe(MAX_REPORTED_KEYS);
    expect(lines.filter((line) => line.level === ERROR)).toHaveLength(MAX_REPORTED_KEYS);

    log.report({ paymentId: 'p', occurrenceId: 'new', errorName: 'E' });
    expect(log.size).toBe(1);
    log.report({ paymentId: 'p', occurrenceId: 'o0', errorName: 'E' });
    expect(lines.filter((line) => line.level === ERROR)).toHaveLength(MAX_REPORTED_KEYS + 2);
  });

  it('logs a missing occurrence at info level', () => {
    const { logger, lines } = captureLogger();

    new RecordingLog(logger).info({
      event: 'occurrence-missing',
      paymentId: 'p',
      occurrenceId: 'o',
    });

    expect(lines.map((line) => line.level)).toEqual([INFO]);
  });
});

describe('createRecurringJobs', () => {
  it('records at 06:00 owner time and not before, with a 60 s interval (AC-15)', async () => {
    const { owner, payment } = await dueRent();
    // America/Cordoba is UTC-3: 08:59 UTC is 05:59 local and 09:00 UTC is 06:00 local.
    const clock = new MutableClock(new Date('2026-10-05T08:59:00.000Z'));
    const job = createRecordingJob(dependenciesFor(clock));
    expect(job.intervalMs).toBe(60_000);

    await job.runOnce();
    expect(await countMovements(owner.ownerId)).toBe(0);

    clock.advance(60_000);
    await job.runOnce();
    expect(await countMovements(owner.ownerId)).toBe(1);
    expect(await statusOf(payment.id)).toEqual(['confirmed']);
  });

  it('two job processes over the same due occurrence leave one expense (AC-09)', async () => {
    const { owner, payment } = await dueRent();
    const clock = new MutableClock(new Date('2026-10-05T15:00:00.000Z'));

    await Promise.all([
      createRecordingJob(dependenciesFor(clock)).runOnce(),
      createRecordingJob(dependenciesFor(clock)).runOnce(),
    ]);

    expect(await countMovements(owner.ownerId)).toBe(1);
    expect(await statusOf(payment.id)).toEqual(['confirmed']);
  });

  it('a second job instance started after the first stopped loses nothing (AC-08)', async () => {
    const { owner, payment } = await dueRent();
    const clock = new MutableClock(new Date('2026-10-05T15:00:00.000Z'));
    const dependencies = dependenciesFor(clock, 1);

    const first = createRecurringJobs(dependencies);
    first.start();
    await vi.waitFor(async () => {
      expect(await statusOf(payment.id)).toEqual(['confirmed']);
    });
    await first.stop();
    await first.stop();

    clock.advance(31 * 24 * 3_600_000);
    const second = createRecurringJobs(dependencies);
    second.start();
    await vi.waitFor(async () => {
      expect(await statusOf(payment.id)).toEqual(['confirmed', 'confirmed']);
    });
    await second.stop();

    expect(await countMovements(owner.ownerId)).toBe(2);
  });

  it('issues each pass scope for the owner found by the source join', async () => {
    const { owner } = await dueRent();
    const clock = new MutableClock(new Date('2026-10-05T15:00:00.000Z'));
    const base = dependenciesFor(clock);
    const seen: string[] = [];
    const job = createRecordingJob({
      ...base,
      recorder: {
        record: (scope, expense) => base.recorder.record(scope, expense),
        recordOnce: (scope, id, expense) => {
          seen.push(scope.userId);
          return base.recorder.recordOnce(scope, id, expense);
        },
      },
    });

    await job.runOnce();

    expect(seen).toContain(owner.ownerId);
  });

  it('the module index does not export the job, the source or the factory', () => {
    const index = readFileSync(new URL('../../src/recurring/index.ts', import.meta.url), 'utf8');
    expect(index).not.toMatch(/jobs|automatic-payment-source|recording-job/);
  });
});
