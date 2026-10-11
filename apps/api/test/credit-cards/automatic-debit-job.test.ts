import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DebitSummary } from '../../src/credit-cards/application/record-automatic-debits';
import { automaticDebitMovementId } from '../../src/credit-cards/domain/automatic-debit';
import { DrizzleCreditCardRepository } from '../../src/credit-cards/infrastructure/db/drizzle-credit-card-repository';
import {
  AutomaticDebitJob,
  AutomaticDebitLog,
  MAX_REPORTED_KEYS,
} from '../../src/credit-cards/infrastructure/jobs/automatic-debit-job';
import { createAutomaticDebitJob } from '../../src/credit-cards/jobs';
import {
  createAutomaticDebitRecorder,
  createCardPayments,
  createCardPurchases,
} from '../../src/movements';
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

const emptySummary: DebitSummary = {
  cards: 0,
  recorded: 0,
  skippedCovered: 0,
  skippedUnavailable: 0,
  skippedRefused: 0,
  alreadySettled: 0,
  failed: 0,
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function stubJob(execute: () => Promise<DebitSummary>, intervalMs = 60_000) {
  const { logger, lines } = captureLogger();
  return { job: new AutomaticDebitJob({ execute, logger, intervalMs }), lines };
}

/** 06:10 local (America/Cordoba is UTC-3) of the due date 2026-11-05 of the 2026-10 statement. */
const DUE_0610 = '2026-11-05T09:10:00.000Z';
const BEFORE_0600 = '2026-11-05T08:00:00.000Z';

/** A card with an ARS debit account and 40,000.00 ARS of purchases in the 2026-10 statement. */
async function scenario(options: { archivedDebit?: boolean; amount?: bigint } = {}) {
  const amount = options.amount ?? 4_000_000n;
  const ownerId = await newUserId(connection.db);
  const bank = await newAccount(connection.pool, ownerId, options.archivedDebit ?? false);
  const cards = new DrizzleCreditCardRepository(connection.db);
  const scope = await writeScope(ownerId);
  const { card } = await cards.create(scope, {
    name: `Visa ${randomUUID().slice(0, 8)}`,
    closingDay: 24,
    dueDay: 5,
    firstStatement: { period: '2026-10', closingDate: '2026-10-24', dueDate: '2026-11-05' },
  });
  await cards.updateDebitAccounts(scope, card.id, {
    ARS: { accountId: bank, linkedOn: '2026-10-01' },
    USD: null,
  });
  const categoryId = await newCategory(connection.pool, ownerId, 'expense');
  await connection.pool.query(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
     values ($1, 'expense', $2, $3, $4, '2026-10-10T15:00:00Z', 14000000, 'manual')`,
    [ownerId, card.arsAccountId, categoryId, amount.toString()],
  );
  return { ownerId, bank, card, amount };
}

function dependenciesFor(clock: MutableClock, intervalSeconds = 60) {
  const { logger, lines } = captureLogger();
  return {
    lines,
    deps: {
      db: connection.db,
      logger,
      recorder: createAutomaticDebitRecorder(connection.db, { clock }),
      cardPayments: createCardPayments(connection.db),
      purchases: createCardPurchases(connection.db),
      clock,
      intervalSeconds,
    },
  };
}

async function net(accountId: string): Promise<bigint> {
  const result = await connection.pool.query<{ net: string }>(
    `select coalesce(sum(case when destination_account_id = $1 then destination_amount else 0 end), 0)
          - coalesce(sum(case when account_id = $1 then amount else 0 end), 0) as net
     from movements where (account_id = $1 or destination_account_id = $1) and type = 'transfer'`,
    [accountId],
  );
  return BigInt(result.rows[0]?.net ?? '0');
}

async function transfersOf(ownerId: string) {
  const result = await connection.pool.query<{
    id: string;
    account_id: string;
    destination_account_id: string;
    amount: string;
  }>(
    "select id, account_id, destination_account_id, amount from movements where owner_id = $1 and type = 'transfer' order by created_at",
    [ownerId],
  );
  return result.rows;
}

async function rowsOf(cardId: string) {
  const result = await connection.pool.query<{
    period: string;
    currency: string;
    status: string;
    reason: string | null;
    movement_id: string | null;
  }>(
    'select period, currency, status, reason, movement_id from card_automatic_debits where card_id = $1 order by period, currency',
    [cardId],
  );
  return result.rows;
}

describe('AutomaticDebitJob scheduling', () => {
  it('a pass that throws does not stop the job; stop() twice is harmless', async () => {
    vi.useFakeTimers();
    const execute = vi
      .fn<() => Promise<DebitSummary>>()
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

  it('logs only the error class of a failed pass, never its message (D11, sad path)', async () => {
    vi.useFakeTimers();
    const secret = 'insert into users (password_hash) values (s3cr3t-hash-4242)';
    const execute = vi.fn<() => Promise<DebitSummary>>().mockRejectedValue(new TypeError(secret));
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

  it('sad path: stop() waits for the pass in progress and then closes; stop() before start() is harmless', async () => {
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

  it('logs a pass that recorded something at info level and an idle pass at debug level', async () => {
    const busy = stubJob(() => Promise.resolve({ ...emptySummary, recorded: 2 }));
    await busy.job.runOnce();
    expect(busy.lines.find((line) => line.level === INFO)?.obj).toMatchObject({ recorded: 2 });

    const idle = stubJob(() => Promise.resolve(emptySummary));
    await idle.job.runOnce();
    expect(idle.lines.map((line) => line.level)).toEqual([20]);
  });
});

describe('AutomaticDebitLog', () => {
  const allowed = ['level', 'time', 'pid', 'hostname', 'msg', 'cardId', 'period', 'currency'];

  it('logs a repeated failure once per key and error class, identifiers only (NFR-01)', () => {
    const { logger, lines } = captureLogger();
    const log = new AutomaticDebitLog(logger);
    const failure = {
      cardId: 'c1',
      period: '2026-10',
      currency: 'ARS' as const,
      errorName: 'AccountArchived',
    };

    log.report(failure);
    log.report(failure);
    log.report({ ...failure, errorName: 'RateUnavailable' });
    log.report({ ...failure, currency: 'USD' });

    const errors = lines.filter((line) => line.level === ERROR);
    expect(errors).toHaveLength(3);
    expect(errors[0]?.obj).toMatchObject({
      cardId: 'c1',
      period: '2026-10',
      currency: 'ARS',
      errorName: 'AccountArchived',
    });
    for (const line of errors) {
      expect(
        Object.keys(line.obj).filter((key) => ![...allowed, 'errorName'].includes(key)),
      ).toEqual([]);
    }
  });

  it('bounds the de-duplication set at 10,000 keys, clearing it when full', () => {
    const { logger, lines } = captureLogger();
    const log = new AutomaticDebitLog(logger);
    expect(MAX_REPORTED_KEYS).toBe(10_000);
    const failure = (i: number) => ({
      cardId: `c${i}`,
      period: null,
      currency: null,
      errorName: 'E',
    });
    for (let i = 0; i < MAX_REPORTED_KEYS; i++) log.report(failure(i));
    expect(log.size).toBe(MAX_REPORTED_KEYS);

    log.report(failure(0));
    expect(log.size).toBe(MAX_REPORTED_KEYS);
    expect(lines.filter((line) => line.level === ERROR)).toHaveLength(MAX_REPORTED_KEYS);

    log.report(failure(MAX_REPORTED_KEYS));
    expect(log.size).toBe(1);
    log.report(failure(0));
    expect(lines.filter((line) => line.level === ERROR)).toHaveLength(MAX_REPORTED_KEYS + 2);
  });

  it('logs a settled debit at info level with the reason and no amount', () => {
    const { logger, lines } = captureLogger();

    new AutomaticDebitLog(logger).info({
      event: 'skipped',
      cardId: 'c',
      period: '2026-10',
      currency: 'ARS',
      reason: 'covered',
    });

    expect(lines.map((line) => line.level)).toEqual([INFO]);
    expect(lines[0]?.obj).toMatchObject({ cardId: 'c', reason: 'covered', event: 'skipped' });
  });
});

describe('createAutomaticDebitJob', () => {
  it('records the transfer at 06:10 local and moves both balances (AC-08)', async () => {
    const { ownerId, bank, card, amount } = await scenario();
    const clock = new MutableClock(new Date(DUE_0610));
    const { deps } = dependenciesFor(clock);
    const job = createAutomaticDebitJob(deps);
    expect(job.intervalMs).toBe(60_000);

    const summary = await job.runOnce();

    expect(summary).toMatchObject({ cards: 1, recorded: 1, failed: 0 });
    const transfers = await transfersOf(ownerId);
    expect(transfers).toEqual([
      {
        id: automaticDebitMovementId(card.id, '2026-10', 'ARS'),
        account_id: bank,
        destination_account_id: card.arsAccountId,
        amount: amount.toString(),
      },
    ]);
    expect(await net(bank)).toBe(-amount);
    expect(await net(card.arsAccountId)).toBe(amount);
  });

  it('a job started after 06:00 that had no earlier pass records in its first pass (AC-10)', async () => {
    const { ownerId } = await scenario();
    const clock = new MutableClock(new Date('2026-11-05T21:00:00.000Z'));
    const { deps } = dependenciesFor(clock, 1);
    const job = createAutomaticDebitJob(deps);

    job.start();
    await vi.waitFor(async () => {
      expect(await transfersOf(ownerId)).toHaveLength(1);
    });
    await job.stop();
  });

  it('passes every 60 s record the transfer within 15 minutes of 06:00 local (NFR-02)', async () => {
    const { ownerId } = await scenario();
    // 05:58 local; every pass advances one interval.
    const clock = new MutableClock(new Date('2026-11-05T08:58:00.000Z'));
    const { deps } = dependenciesFor(clock);
    const job = createAutomaticDebitJob(deps);
    expect(job.intervalMs).toBeLessThanOrEqual(300_000);

    let recordedAtMinutes: number | null = null;
    for (let minute = -2; minute <= 15; minute++) {
      await job.runOnce();
      if (recordedAtMinutes === null && (await transfersOf(ownerId)).length === 1) {
        recordedAtMinutes = minute;
      }
      clock.advance(job.intervalMs);
    }

    expect(recordedAtMinutes).not.toBeNull();
    expect(recordedAtMinutes).toBeGreaterThanOrEqual(0);
    expect(recordedAtMinutes).toBeLessThanOrEqual(15);
  });

  it('three passes over the same statement leave 1 transfer and 1 claim row (AC-09)', async () => {
    const { ownerId, bank, amount, card } = await scenario();
    const clock = new MutableClock(new Date(DUE_0610));
    const job = createAutomaticDebitJob(dependenciesFor(clock).deps);

    await job.runOnce();
    const afterFirst = await net(bank);
    const second = await job.runOnce();
    const third = await job.runOnce();

    expect(await transfersOf(ownerId)).toHaveLength(1);
    expect(await rowsOf(card.id)).toHaveLength(1);
    expect(await net(bank)).toBe(afterFirst);
    expect(afterFirst).toBe(-amount);
    expect(second.recorded).toBe(0);
    expect(third.recorded).toBe(0);
  });

  it('two passes running at the same time leave exactly 1 transfer (AC-09)', async () => {
    const { ownerId, card } = await scenario();
    const clock = new MutableClock(new Date(DUE_0610));

    await Promise.all([
      createAutomaticDebitJob(dependenciesFor(clock).deps).runOnce(),
      createAutomaticDebitJob(dependenciesFor(clock).deps).runOnce(),
    ]);

    expect(await transfersOf(ownerId)).toHaveLength(1);
    expect(await rowsOf(card.id)).toHaveLength(1);
  });

  it('a crash after recording and before the claim commits is repaired by a rerun (NFR-03)', async () => {
    const { ownerId, card } = await scenario();
    const clock = new MutableClock(new Date(DUE_0610));
    const base = dependenciesFor(clock);
    const crashing = createAutomaticDebitJob({
      ...base.deps,
      recorder: {
        recordOnce: async (scope, id, transfer) => {
          await base.deps.recorder.recordOnce(scope, id, transfer);
          throw new Error('process crashed');
        },
      },
    });

    const crashed = await crashing.runOnce();
    expect(crashed.failed).toBe(1);
    expect(await transfersOf(ownerId)).toHaveLength(1);
    expect(await rowsOf(card.id)).toEqual([]);

    const rerun = await createAutomaticDebitJob(dependenciesFor(clock).deps).runOnce();

    // The orphan transfer already covers the statement, so the rerun settles it as covered.
    expect(rerun).toMatchObject({ recorded: 0, skippedCovered: 1, failed: 0 });
    const transfers = await transfersOf(ownerId);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.id).toBe(automaticDebitMovementId(card.id, '2026-10', 'ARS'));
    expect(await rowsOf(card.id)).toEqual([
      expect.objectContaining({ status: 'skipped', reason: 'covered' }),
    ]);
  });

  it('a statement paid by hand before the due time records nothing and settles covered (AC-06)', async () => {
    const { ownerId, bank, card, amount } = await scenario();
    const clock = new MutableClock(new Date(BEFORE_0600));
    const job = createAutomaticDebitJob(dependenciesFor(clock).deps);

    await job.runOnce();
    expect(await transfersOf(ownerId)).toHaveLength(0);
    await newTransfer(connection.pool, {
      ownerId,
      accountId: bank,
      destinationAccountId: card.arsAccountId,
      amount,
    });
    clock.advance(70 * 60_000);
    const summary = await job.runOnce();

    expect(summary.skippedCovered).toBe(1);
    expect(await transfersOf(ownerId)).toHaveLength(1);
    expect(await rowsOf(card.id)).toEqual([
      expect.objectContaining({ status: 'skipped', reason: 'covered', movement_id: null }),
    ]);
  });

  it('an archived debit account leaves the statement unpaid, settles skipped and logs ids only (AC-07)', async () => {
    const { ownerId, bank, card, amount } = await scenario({ archivedDebit: true });
    const names = await connection.pool.query<{ name: string }>(
      'select name from accounts where owner_id = $1 union select name from credit_cards where owner_id = $1',
      [ownerId],
    );
    const clock = new MutableClock(new Date(DUE_0610));
    const { deps, lines } = dependenciesFor(clock);
    const job = createAutomaticDebitJob(deps);

    const first = await job.runOnce();
    const second = await job.runOnce();

    expect(first.skippedUnavailable).toBe(1);
    expect(second.skippedUnavailable).toBe(0);
    expect(await transfersOf(ownerId)).toHaveLength(0);
    expect(await net(bank)).toBe(0n);
    expect(await net(card.arsAccountId)).toBe(0n);
    expect(await rowsOf(card.id)).toEqual([
      expect.objectContaining({ status: 'skipped', reason: 'account_unavailable' }),
    ]);
    const logged = JSON.stringify(lines.map((line) => line.obj));
    expect(logged).toContain(card.id);
    expect(logged).not.toContain(amount.toString());
    for (const { name } of names.rows) expect(logged).not.toContain(name);
    expect(logged).not.toContain(bank);
  });

  it('an error on one card is reported, does not stop the next card, and the next pass retries it (NFR-03)', async () => {
    const failing = await scenario();
    const healthy = await scenario({ amount: 1_500_000n });
    const clock = new MutableClock(new Date(DUE_0610));
    const base = dependenciesFor(clock);
    const job = createAutomaticDebitJob({
      ...base.deps,
      recorder: {
        recordOnce: (scope, id, transfer) => {
          if (scope.userId === failing.ownerId) return Promise.reject(new Error('storage down'));
          return base.deps.recorder.recordOnce(scope, id, transfer);
        },
      },
    });

    const summary = await job.runOnce();

    expect(summary).toMatchObject({ cards: 2, recorded: 1, failed: 1 });
    expect(await transfersOf(failing.ownerId)).toHaveLength(0);
    expect(await transfersOf(healthy.ownerId)).toHaveLength(1);
    const errors = base.lines.filter((line) => line.level === ERROR);
    expect(errors[0]?.obj).toMatchObject({ cardId: failing.card.id, errorName: 'Error' });
    expect(JSON.stringify(errors.map((line) => line.obj))).not.toContain('storage down');

    const retry = await createAutomaticDebitJob(dependenciesFor(clock).deps).runOnce();
    expect(retry.recorded).toBe(1);
    expect(await transfersOf(failing.ownerId)).toHaveLength(1);
  });

  it('records each owner transfer only between that owner accounts (cross-user, NFR-03)', async () => {
    const ana = await scenario({ amount: 4_000_000n });
    const bea = await scenario({ amount: 1_250_000n });
    const clock = new MutableClock(new Date(DUE_0610));

    await createAutomaticDebitJob(dependenciesFor(clock).deps).runOnce();

    expect(await transfersOf(ana.ownerId)).toEqual([
      expect.objectContaining({
        account_id: ana.bank,
        destination_account_id: ana.card.arsAccountId,
        amount: '4000000',
      }),
    ]);
    expect(await transfersOf(bea.ownerId)).toEqual([
      expect.objectContaining({
        account_id: bea.bank,
        destination_account_id: bea.card.arsAccountId,
        amount: '1250000',
      }),
    ]);
    expect(await net(ana.bank)).toBe(-4_000_000n);
    expect(await net(bea.bank)).toBe(-1_250_000n);
    expect(await net(ana.card.arsAccountId)).toBe(4_000_000n);
    expect(await net(bea.card.arsAccountId)).toBe(1_250_000n);
  });

  it('the module index does not export the job, the source or the factory (NFR-03)', () => {
    const index = readFileSync(new URL('../../src/credit-cards/index.ts', import.meta.url), 'utf8');
    expect(index).not.toMatch(/jobs|automatic-debit-source|automatic-debit-job|AutomaticDebitJob/);
  });
});
