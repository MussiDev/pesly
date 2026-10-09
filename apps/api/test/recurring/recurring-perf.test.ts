import { upcomingResponseSchema } from '@pesly/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRecurringExpenseRecorder } from '../../src/movements';
import { createRecurringRoutes } from '../../src/recurring';
import { RecordDueOccurrences } from '../../src/recurring/application/record-due-occurrences';
import { DrizzleAutomaticPaymentSource } from '../../src/recurring/infrastructure/db/drizzle-automatic-payment-source';
import { DrizzleOccurrenceRepository } from '../../src/recurring/infrastructure/db/drizzle-occurrence-repository';
import { DrizzleRecurringPaymentRepository } from '../../src/recurring/infrastructure/db/drizzle-recurring-payment-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';
import { newAccount, newCategory, writeScope } from '../movements/db-fixtures';
import { FakeClock, FakeExpenseRecorder, writeScopeFor } from './fakes';
import { newRecurringOwner, rentOf } from './fixtures';

/** NFR-02: p95 of `GET /recurring/upcoming` for a user with 100 recurring payments. */
const PAYMENTS = 100;
const REQUESTS = 50;
const MAX_P95_MS = 300;

/** NFR-03: one recording pass over 10,000 active automatic payments, 1,000 of them due. */
const JOB_PAYMENTS = 10_000;
const JOB_DUE = 1_000;
const MAX_PASS_MS = 60_000;

let connection: DatabaseConnection;

/** The run fails when a pass takes the whole budget or more. */
function assertPassWithinBudget(elapsedMs: number): void {
  if (elapsedMs >= MAX_PASS_MS) {
    throw new Error(`The recording pass took ${Math.round(elapsedMs)} ms, the budget is 60 s`);
  }
}

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

describe('upcoming latency (NFR-02)', () => {
  it('keeps p95 of 50 reads with 100 payments below 300 ms', async () => {
    const logger = createLogger({ level: 'error', destination: { write: () => undefined } });
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [
        createRecurringRoutes({
          db: connection.db,
          logger,
          expenses: createRecurringExpenseRecorder(connection.db, logger),
        }),
      ],
    });
    const email = 'perf-recurring@example.com';
    const password = 'a long enough passphrase';
    const ownerId = await seedUser(connection, { email, password });
    const cookies = sessionFrom(await signIn(harness.app, email, password));
    const accountId = await newAccount(connection.pool, ownerId);
    const categoryId = await newCategory(connection.pool, ownerId, 'expense');
    const repository = new DrizzleRecurringPaymentRepository(connection.db);
    const scope = await writeScope(ownerId);
    const owner = { ownerId, accountId, categoryId };
    for (let i = 0; i < PAYMENTS; i += 1) {
      await repository.create(
        scope,
        rentOf(owner, {
          name: `Payment ${i}`,
          frequency: 'weekly',
          weekday: i % 7,
          dayOfMonth: null,
          startDate: '2026-01-05',
          scheduleFrom: '2026-01-05',
          autoRecordingFrom: '2026-01-05',
        }),
      );
    }

    const latencies: number[] = [];
    for (let i = 0; i < REQUESTS; i += 1) {
      const started = performance.now();
      const response = await request(harness.app)
        .get('/recurring/upcoming')
        .set(trustedHeaders)
        .set('Cookie', cookieHeader(cookies));
      latencies.push(performance.now() - started);
      expect(response.status).toBe(200);
      expect(upcomingResponseSchema.parse(response.body).items.length).toBeGreaterThan(0);
    }

    const p95 = percentile(latencies, 95);
    console.log(`[08a NFR-02] upcoming: ${latencies.length} requests, p95 = ${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(MAX_P95_MS);
  }, 180_000);
});

describe('recording pass duration (NFR-03, AC-16)', () => {
  it('rejects a pass that takes 60 s or more and accepts a shorter one', () => {
    expect(() => {
      assertPassWithinBudget(MAX_PASS_MS - 1);
    }).not.toThrow();
    expect(() => {
      assertPassWithinBudget(MAX_PASS_MS);
    }).toThrow(/60 s/);
    expect(() => {
      assertPassWithinBudget(MAX_PASS_MS + 5_000);
    }).toThrow(/60 s/);
  });

  it('records 1,000 due payments out of 10,000 in under 60 s', async () => {
    const owner = await newRecurringOwner(connection.db, connection.pool);
    // Bulk seed: 1,000 monthly payments due on the 5th and 9,000 starting later this month.
    await connection.pool.query(
      `insert into recurring_payments
         (owner_id, name, amount, account_id, category_id, frequency, day_of_month, start_date, mode, schedule_from, auto_recording_from)
       select $1, 'Bulk ' || n, 1000, $2, $3, 'monthly',
              case when n <= $5 then 5 else 20 end,
              case when n <= $5 then date '2026-10-05' else date '2026-10-20' end,
              'automatic',
              case when n <= $5 then date '2026-10-05' else date '2026-10-20' end,
              case when n <= $5 then date '2026-10-05' else date '2026-10-20' end
       from generate_series(1, $4::int) as n`,
      [owner.ownerId, owner.accountId, owner.categoryId, JOB_PAYMENTS, JOB_DUE],
    );
    const clock = new FakeClock(new Date('2026-10-05T12:00:00.000Z'));
    const recorder = new FakeExpenseRecorder(clock);
    const failures: unknown[] = [];
    const job = new RecordDueOccurrences({
      source: new DrizzleAutomaticPaymentSource(connection.db),
      occurrences: new DrizzleOccurrenceRepository(connection.db),
      expenses: recorder,
      clock,
      scopeFor: (ownerId) => writeScopeFor(ownerId),
      report: (failure) => failures.push(failure),
      info: () => undefined,
    });

    try {
      const started = performance.now();
      const summary = await job.execute();
      const elapsed = performance.now() - started;
      console.log(
        `[08b NFR-03] pass: ${summary.payments} payments, ${summary.recorded} recorded, ${(elapsed / 1000).toFixed(1)} s`,
      );

      expect(failures).toEqual([]);
      expect(recorder.expenses.filter((e) => e.ownerId === owner.ownerId)).toHaveLength(JOB_DUE);
      assertPassWithinBudget(elapsed);
    } finally {
      await connection.pool.query('delete from recurring_payments where owner_id = $1', [
        owner.ownerId,
      ]);
    }
  }, 300_000);
});
