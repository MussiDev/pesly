import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNoticePublisher } from '../../src/notices';
import { CreateDueReminders } from '../../src/recurring/application/create-due-reminders';
import { DrizzleOccurrenceRepository } from '../../src/recurring/infrastructure/db/drizzle-occurrence-repository';
import { DrizzleReminderPaymentSource } from '../../src/recurring/infrastructure/db/drizzle-reminder-payment-source';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { FakeClock } from '../recurring/fakes';
import { newRecurringOwner } from '../recurring/fixtures';

/** NFR-03: one reminder pass over 10,000 active payments, 1,000 of them with a reminder due. */
const JOB_PAYMENTS = 10_000;
const JOB_DUE = 1_000;
const MAX_PASS_MS = 60_000;

let connection: DatabaseConnection;

/** The run fails when a pass takes the whole budget or more. */
function assertPassWithinBudget(elapsedMs: number): void {
  if (elapsedMs >= MAX_PASS_MS) {
    throw new Error(`The reminder pass took ${Math.round(elapsedMs)} ms, the budget is 60 s`);
  }
}

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

describe('reminder pass duration (NFR-03)', () => {
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

  it('creates 1,000 reminders out of 10,000 active payments in under 60 s', async () => {
    const owner = await newRecurringOwner(connection.db, connection.pool);
    // Monthly payments of both modes. The first 1,000 are due on the 10th with 3 reminder days, so
    // their reminder day is the 7th; the other 9,000 are due on the 25th, whose reminder is later.
    await connection.pool.query(
      `insert into recurring_payments
         (owner_id, name, amount, account_id, category_id, frequency, day_of_month, start_date, mode, schedule_from, auto_recording_from, reminder_days)
       select $1, 'Bulk ' || n, 1000, $2, $3, 'monthly',
              case when n <= $5 then 10 else 25 end,
              date '2026-09-01',
              case when n % 2 = 0 then 'automatic' else 'confirmation' end,
              date '2026-09-01',
              date '2026-09-01',
              3
       from generate_series(1, $4::int) as n`,
      [owner.ownerId, owner.accountId, owner.categoryId, JOB_PAYMENTS, JOB_DUE],
    );
    // America/Cordoba is UTC-3: 12:00 UTC on the 7th is 09:00 local, the reminder time.
    const clock = new FakeClock(new Date('2026-10-07T12:00:00.000Z'));
    const failures: unknown[] = [];
    const job = new CreateDueReminders({
      source: new DrizzleReminderPaymentSource(connection.db),
      occurrences: new DrizzleOccurrenceRepository(connection.db),
      notices: createNoticePublisher(connection.db),
      clock,
      report: (failure) => failures.push(failure),
    });

    try {
      const started = performance.now();
      const summary = await job.execute();
      const elapsed = performance.now() - started;
      console.log(
        `[08c NFR-03] pass: ${summary.payments} payments, ${summary.reminders} reminders, ${(elapsed / 1000).toFixed(1)} s`,
      );

      expect(failures).toEqual([]);
      expect(summary).toEqual({ payments: JOB_PAYMENTS, reminders: JOB_DUE, failed: 0 });
      const stored = await connection.pool.query<{ total: string }>(
        `select count(*)::text as total from notices where owner_id = $1 and kind = 'reminder'`,
        [owner.ownerId],
      );
      expect(stored.rows[0]?.total).toBe(String(JOB_DUE));
      assertPassWithinBudget(elapsed);
    } finally {
      await connection.pool.query('delete from recurring_payments where owner_id = $1', [
        owner.ownerId,
      ]);
    }
  }, 300_000);
});
