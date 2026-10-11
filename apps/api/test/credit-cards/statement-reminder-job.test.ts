import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReminderSummary } from '../../src/credit-cards/application/create-statement-reminders';
import { DrizzleCreditCardRepository } from '../../src/credit-cards/infrastructure/db/drizzle-credit-card-repository';
import {
  MAX_REPORTED_KEYS,
  StatementReminderJob,
  StatementReminderLog,
} from '../../src/credit-cards/infrastructure/jobs/statement-reminder-job';
import { createStatementReminderJob } from '../../src/credit-cards/jobs';
import { createCardPayments, createCardPurchases } from '../../src/movements';
import { createStatementReminderPublisher } from '../../src/notices';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger, type Logger } from '../../src/shared/logging/logger';
import { MutableClock } from '../fakes/mutable-clock';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  newAccount,
  newCategory,
  newTransfer,
  newUserId,
  writeScope,
} from '../movements/db-fixtures';

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

const emptySummary: ReminderSummary = {
  cards: 0,
  reminders: 0,
  notOwed: 0,
  alreadyPublished: 0,
  failed: 0,
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function stubJob(execute: () => Promise<ReminderSummary>, intervalMs = 60_000) {
  const { logger, lines } = captureLogger();
  return { job: new StatementReminderJob({ execute, logger, intervalMs }), lines };
}

/*
 * The 2026-10 statement closes 2026-10-24 and is due 2026-11-05; with 3 reminder days the reminder
 * day is 2026-11-02 at 09:00 local. America/Cordoba is UTC-3 and Asia/Tokyo is UTC+9.
 */
const CORDOBA_0859 = '2026-11-02T11:59:00.000Z';
const CORDOBA_0900 = '2026-11-02T12:00:00.000Z';
const CORDOBA_0910 = '2026-11-02T12:10:00.000Z';
const TOKYO_0859 = '2026-11-01T23:59:00.000Z';
const TOKYO_0900 = '2026-11-02T00:00:00.000Z';

/** A card with 40,000.00 ARS of purchases in the 2026-10 statement. */
async function scenario(
  options: {
    timeZone?: string;
    language?: 'es' | 'en';
    amount?: bigint;
    reminderDays?: number;
    purchases?: boolean;
  } = {},
) {
  const amount = options.amount ?? 4_000_000n;
  const ownerId = await newUserId(
    connection.db,
    options.timeZone ? { timeZone: options.timeZone } : {},
  );
  if (options.language) {
    await connection.pool.query('update users set language = $2 where id = $1', [
      ownerId,
      options.language,
    ]);
  }
  const cards = new DrizzleCreditCardRepository(connection.db);
  const scope = await writeScope(ownerId);
  const { card } = await cards.create(scope, {
    name: `Visa ${randomUUID().slice(0, 8)}`,
    closingDay: 24,
    dueDay: 5,
    reminderDays: options.reminderDays ?? 3,
    firstStatement: { period: '2026-10', closingDate: '2026-10-24', dueDate: '2026-11-05' },
  });
  const categoryId = await newCategory(connection.pool, ownerId, 'expense');
  if (options.purchases !== false) {
    await connection.pool.query(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
     values ($1, 'expense', $2, $3, $4, '2026-10-10T15:00:00Z', 14000000, 'manual')`,
      [ownerId, card.arsAccountId, categoryId, amount.toString()],
    );
  }
  return { ownerId, card, cards, scope, amount };
}

function dependenciesFor(clock: MutableClock, intervalSeconds = 60) {
  const { logger, lines } = captureLogger();
  return {
    lines,
    deps: {
      db: connection.db,
      logger,
      publisher: createStatementReminderPublisher(connection.db),
      cardPayments: createCardPayments(connection.db),
      purchases: createCardPurchases(connection.db),
      clock,
      intervalSeconds,
    },
  };
}

async function noticesOf(ownerId: string) {
  const result = await connection.pool.query<{
    kind: string;
    text: string;
    due_date: string;
    payment_id: string;
  }>(
    "select kind, text, to_char(due_date, 'YYYY-MM-DD') as due_date, payment_id from notices where owner_id = $1 order by created_at",
    [ownerId],
  );
  return result.rows;
}

describe('StatementReminderJob scheduling', () => {
  it('a pass that throws does not stop the job; stop() twice is harmless', async () => {
    vi.useFakeTimers();
    const execute = vi
      .fn<() => Promise<ReminderSummary>>()
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

  it('logs only the error class of a failed pass, never its message (D16, sad path)', async () => {
    vi.useFakeTimers();
    const secret = 'insert into users (password_hash) values (s3cr3t-hash-4242)';
    const execute = vi
      .fn<() => Promise<ReminderSummary>>()
      .mockRejectedValue(new TypeError(secret));
    const { job, lines } = stubJob(execute);

    job.start();
    await flush();
    await job.stop();

    const errors = lines.filter((line) => line.level === ERROR);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.obj.errorName).toBe('TypeError');
    expect(JSON.stringify(lines)).not.toContain('s3cr3t');
    expect(JSON.stringify(lines)).not.toContain('insert into');
  });

  it('waits the interval after a pass and never overlaps passes; start() twice runs one chain', async () => {
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

  it('sad path: stop() waits for the pass in progress; stop() before start() is harmless', async () => {
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
    await job.stop();
    job.start();
    await flush();

    const stopping = job.stop().then(() => events.push('stopped'));
    await flush();
    expect(events).toEqual([]);
    release?.();
    await stopping;

    expect(events).toEqual(['pass finished', 'stopped']);
  });

  it('logs a pass that created or failed at info level and an idle pass at debug level', async () => {
    const created = stubJob(() => Promise.resolve({ ...emptySummary, reminders: 2 }));
    await created.job.runOnce();
    expect(created.lines.find((line) => line.level === INFO)?.obj).toMatchObject({ reminders: 2 });

    const failed = stubJob(() => Promise.resolve({ ...emptySummary, failed: 1 }));
    await failed.job.runOnce();
    expect(failed.lines.map((line) => line.level)).toEqual([INFO]);

    const idle = stubJob(() => Promise.resolve({ ...emptySummary, cards: 3, alreadyPublished: 3 }));
    await idle.job.runOnce();
    expect(idle.lines.map((line) => line.level)).toEqual([20]);
  });
});

describe('StatementReminderLog', () => {
  it('logs a repeated failure once per card and error class, identifiers only (D16)', () => {
    const { logger, lines } = captureLogger();
    const log = new StatementReminderLog(logger);
    const failure = { cardId: 'c1', errorName: 'ResourceNotFound' };

    log.report(failure);
    log.report(failure);
    log.report({ ...failure, errorName: 'Error' });
    log.report({ ...failure, cardId: 'c2' });

    const errors = lines.filter((line) => line.level === ERROR);
    expect(errors).toHaveLength(3);
    expect(errors[0]?.obj).toMatchObject({ cardId: 'c1', errorName: 'ResourceNotFound' });
    const allowed = ['level', 'time', 'pid', 'hostname', 'msg', 'cardId', 'errorName'];
    for (const line of errors) {
      expect(Object.keys(line.obj).filter((key) => !allowed.includes(key))).toEqual([]);
    }
  });

  it('bounds the de-duplication set at 10,000 keys, clearing it when full', () => {
    const { logger, lines } = captureLogger();
    const log = new StatementReminderLog(logger);
    expect(MAX_REPORTED_KEYS).toBe(10_000);
    for (let i = 0; i < MAX_REPORTED_KEYS; i++) log.report({ cardId: `c${i}`, errorName: 'E' });
    expect(log.size).toBe(MAX_REPORTED_KEYS);

    log.report({ cardId: 'c0', errorName: 'E' });
    expect(log.size).toBe(MAX_REPORTED_KEYS);
    expect(lines.filter((line) => line.level === ERROR)).toHaveLength(MAX_REPORTED_KEYS);

    log.report({ cardId: 'extra', errorName: 'E' });
    expect(log.size).toBe(1);
    log.report({ cardId: 'c0', errorName: 'E' });
    expect(lines.filter((line) => line.level === ERROR)).toHaveLength(MAX_REPORTED_KEYS + 2);
  });
});

describe('createStatementReminderJob', () => {
  it('at 09:10 local of the reminder day one pass creates the notice with the card name and the due date, no amount (AC-01)', async () => {
    const { ownerId, card, amount } = await scenario({ language: 'en' });
    const clock = new MutableClock(new Date(CORDOBA_0910));
    const job = createStatementReminderJob(dependenciesFor(clock).deps);
    expect(job.intervalMs).toBe(60_000);

    const summary = await job.runOnce();

    expect(summary.reminders).toBeGreaterThanOrEqual(1);
    const notices = await noticesOf(ownerId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'card_statement_due', due_date: '2026-11-05' });
    expect(notices[0]?.text).toBe(`The ${card.name} statement is due on Nov 5`);
    expect(notices[0]?.text).not.toContain(amount.toString());
    expect(notices[0]?.text).not.toContain('40,000');
  });

  it('a Spanish owner gets the Spanish text (AC-01)', async () => {
    const { ownerId, card } = await scenario({ language: 'es' });
    const job = createStatementReminderJob(
      dependenciesFor(new MutableClock(new Date(CORDOBA_0910))).deps,
    );

    await job.runOnce();

    expect((await noticesOf(ownerId))[0]?.text).toBe(`El resumen de ${card.name} vence el 5 nov`);
  });

  it('08:59 local creates nothing and 09:00 does, in two owner time zones (NFR-01)', async () => {
    const cordoba = await scenario({ timeZone: 'America/Cordoba' });
    const tokyo = await scenario({ timeZone: 'Asia/Tokyo' });
    const clock = new MutableClock(new Date(TOKYO_0859));
    const job = createStatementReminderJob(dependenciesFor(clock).deps);

    // 2026-11-01T23:59Z: Tokyo is 08:59 of the reminder day, Cordoba is still the day before.
    await job.runOnce();
    expect(await noticesOf(tokyo.ownerId)).toHaveLength(0);
    expect(await noticesOf(cordoba.ownerId)).toHaveLength(0);

    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe(TOKYO_0900);
    await job.runOnce();
    expect(await noticesOf(tokyo.ownerId)).toHaveLength(1);
    expect(await noticesOf(cordoba.ownerId)).toHaveLength(0);

    clock.advance(new Date(CORDOBA_0859).getTime() - clock.now().getTime());
    await job.runOnce();
    expect(await noticesOf(cordoba.ownerId)).toHaveLength(0);

    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe(CORDOBA_0900);
    await job.runOnce();
    expect(await noticesOf(cordoba.ownerId)).toHaveLength(1);
  });

  it('a job started after the reminder day and before the due date creates it in its first pass; after the due date none (AC-07)', async () => {
    const late = await scenario();
    const midday = new MutableClock(new Date('2026-11-04T20:00:00.000Z'));
    const after = new MutableClock(new Date('2026-11-06T20:00:00.000Z'));

    const first = createStatementReminderJob(dependenciesFor(midday, 1).deps);
    first.start();
    await vi.waitFor(async () => {
      expect(await noticesOf(late.ownerId)).toHaveLength(1);
    });
    await first.stop();

    // Created after the first job stopped, so only a pass past the due date can see it.
    const tooLate = await scenario();
    await createStatementReminderJob(dependenciesFor(after).deps).runOnce();
    expect(await noticesOf(tooLate.ownerId)).toHaveLength(0);
  });

  it('with passes every 60 s the notice exists between 09:00 and 09:15 local (NFR-01)', async () => {
    const { ownerId } = await scenario();
    const clock = new MutableClock(new Date(CORDOBA_0859));
    const job = createStatementReminderJob(dependenciesFor(clock).deps);
    expect(job.intervalMs).toBeLessThanOrEqual(300_000);

    let createdAtMinutes: number | null = null;
    for (let minute = -1; minute <= 15; minute++) {
      await job.runOnce();
      if (createdAtMinutes === null && (await noticesOf(ownerId)).length === 1) {
        createdAtMinutes = minute;
      }
      clock.advance(job.intervalMs);
    }

    expect(createdAtMinutes).not.toBeNull();
    expect(createdAtMinutes).toBeGreaterThanOrEqual(0);
    expect(createdAtMinutes).toBeLessThanOrEqual(15);
  });

  it('three passes over the same statement leave 1 notice (NFR-02)', async () => {
    const { ownerId } = await scenario();
    const job = createStatementReminderJob(
      dependenciesFor(new MutableClock(new Date(CORDOBA_0910))).deps,
    );

    await job.runOnce();
    const second = await job.runOnce();
    await job.runOnce();

    expect(await noticesOf(ownerId)).toHaveLength(1);
    expect(second.reminders).toBe(0);
  });

  it('two passes running at the same time leave exactly 1 notice (NFR-02)', async () => {
    const { ownerId } = await scenario();
    const clock = new MutableClock(new Date(CORDOBA_0910));

    await Promise.all([
      createStatementReminderJob(dependenciesFor(clock).deps).runOnce(),
      createStatementReminderJob(dependenciesFor(clock).deps).runOnce(),
    ]);

    expect(await noticesOf(ownerId)).toHaveLength(1);
  });

  it('a card whose reminder days are 0 reminds on the due date at 09:00 and never earlier', async () => {
    const { ownerId } = await scenario({ reminderDays: 0 });

    await createStatementReminderJob(
      dependenciesFor(new MutableClock(new Date(CORDOBA_0910))).deps,
    ).runOnce();
    expect(await noticesOf(ownerId)).toHaveLength(0);

    await createStatementReminderJob(
      dependenciesFor(new MutableClock(new Date('2026-11-05T12:10:00.000Z'))).deps,
    ).runOnce();
    expect(await noticesOf(ownerId)).toHaveLength(1);
  });

  it('a moved due date makes one new notice for the new date (AC-05)', async () => {
    const { ownerId, card } = await scenario();
    const clock = new MutableClock(new Date(CORDOBA_0910));
    const job = createStatementReminderJob(dependenciesFor(clock).deps);
    await job.runOnce();
    expect(await noticesOf(ownerId)).toHaveLength(1);

    await connection.pool.query(
      "update credit_card_statements set due_date = '2026-11-06' where card_id = $1 and period = '2026-10'",
      [card.id],
    );
    // The new reminder day (3 days before 2026-11-06) is 2026-11-03 at 09:00 local.
    clock.advance(24 * 60 * 60_000);
    await job.runOnce();
    await job.runOnce();

    const notices = await noticesOf(ownerId);
    expect(notices.map((notice) => notice.due_date).sort()).toEqual(['2026-11-05', '2026-11-06']);
  });

  it('a deleted card creates nothing (AC-09)', async () => {
    const { ownerId, card } = await scenario();
    // Raw delete: the repository refuses a card whose account has movements, and this one owes
    // money, so a notice would be created if the card were still read.
    await connection.pool.query('delete from credit_cards where id = $1', [card.id]);

    await createStatementReminderJob(
      dependenciesFor(new MutableClock(new Date(CORDOBA_0910))).deps,
    ).runOnce();

    expect(await noticesOf(ownerId)).toHaveLength(0);
  });

  it('a statement already paid creates nothing (AC-04)', async () => {
    const { ownerId, card, amount } = await scenario();
    const bank = await newAccount(connection.pool, ownerId);
    await newTransfer(connection.pool, {
      ownerId,
      accountId: bank,
      destinationAccountId: card.arsAccountId,
      amount,
    });

    const summary = await createStatementReminderJob(
      dependenciesFor(new MutableClock(new Date(CORDOBA_0910))).deps,
    ).runOnce();

    expect(summary.notOwed).toBeGreaterThanOrEqual(1);
    expect(await noticesOf(ownerId)).toHaveLength(0);
  });

  it('a statement with no total creates no notice while another card statement does (FR-01)', async () => {
    const empty = await scenario({ purchases: false });
    const owing = await scenario();

    const summary = await createStatementReminderJob(
      dependenciesFor(new MutableClock(new Date(CORDOBA_0910))).deps,
    ).runOnce();

    expect(summary.notOwed).toBeGreaterThanOrEqual(1);
    expect(await noticesOf(empty.ownerId)).toHaveLength(0);
    expect(await noticesOf(owing.ownerId)).toHaveLength(1);
  });

  it('each owner gets only the notice of their own card (cross-user)', async () => {
    const ana = await scenario({ language: 'en' });
    const bea = await scenario({ language: 'en', amount: 1_250_000n });

    await createStatementReminderJob(
      dependenciesFor(new MutableClock(new Date(CORDOBA_0910))).deps,
    ).runOnce();

    const anaNotices = await noticesOf(ana.ownerId);
    const beaNotices = await noticesOf(bea.ownerId);
    expect(anaNotices).toHaveLength(1);
    expect(beaNotices).toHaveLength(1);
    expect(anaNotices[0]?.text).toContain(ana.card.name);
    expect(anaNotices[0]?.text).not.toContain(bea.card.name);
    expect(beaNotices[0]?.text).toContain(bea.card.name);
    expect(beaNotices[0]?.text).not.toContain(ana.card.name);
  });

  it('an error on one card is reported with ids only and the next pass retries it (D16)', async () => {
    const failing = await scenario();
    const clock = new MutableClock(new Date(CORDOBA_0910));
    const base = dependenciesFor(clock);
    const real = base.deps.publisher;
    const job = createStatementReminderJob({
      ...base.deps,
      publisher: {
        published: real.published.bind(real),
        publishMany: (inputs) => {
          if (inputs.some((input) => input.ownerId === failing.ownerId)) {
            return Promise.reject(new Error(`storage down ${failing.card.name}`));
          }
          return real.publishMany(inputs);
        },
      },
    });

    const summary = await job.runOnce();

    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(await noticesOf(failing.ownerId)).toHaveLength(0);
    const errors = base.lines.filter((line) => line.level === ERROR);
    expect(errors.some((line) => line.obj.cardId === failing.card.id)).toBe(true);
    expect(JSON.stringify(errors.map((line) => line.obj))).not.toContain('storage down');
    expect(JSON.stringify(errors.map((line) => line.obj))).not.toContain(failing.card.name);

    await createStatementReminderJob(dependenciesFor(clock).deps).runOnce();
    expect(await noticesOf(failing.ownerId)).toHaveLength(1);
  });

  it('the module index does not export the job, the source or the factory (D11)', () => {
    const index = readFileSync(new URL('../../src/credit-cards/index.ts', import.meta.url), 'utf8');
    expect(index).not.toMatch(
      /jobs|statement-reminder-source|statement-reminder-job|StatementReminderJob/,
    );
  });
});
