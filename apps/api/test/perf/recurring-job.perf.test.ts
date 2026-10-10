import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecordDueOccurrences } from '../../src/recurring/application/record-due-occurrences';
import { DrizzleAutomaticPaymentSource } from '../../src/recurring/infrastructure/db/drizzle-automatic-payment-source';
import { DrizzleOccurrenceRepository } from '../../src/recurring/infrastructure/db/drizzle-occurrence-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { FakeClock, FakeExpenseRecorder, writeScopeFor } from '../recurring/fakes';
import { newRecurringOwner } from '../recurring/fixtures';

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
