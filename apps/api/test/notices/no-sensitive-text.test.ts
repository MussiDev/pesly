import { AppError } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNoticePublisher } from '../../src/notices';
import { renderNoticeText, type NoticeLanguage } from '../../src/notices/domain/notice-text';
import { CreateDueReminders } from '../../src/recurring/application/create-due-reminders';
import { RecordDueOccurrences } from '../../src/recurring/application/record-due-occurrences';
import { DrizzleAutomaticPaymentSource } from '../../src/recurring/infrastructure/db/drizzle-automatic-payment-source';
import { DrizzleOccurrenceRepository } from '../../src/recurring/infrastructure/db/drizzle-occurrence-repository';
import { DrizzleRecurringPaymentRepository } from '../../src/recurring/infrastructure/db/drizzle-recurring-payment-repository';
import { DrizzleReminderPaymentSource } from '../../src/recurring/infrastructure/db/drizzle-reminder-payment-source';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { FakeClock, FakeExpenseRecorder, writeScopeFor } from '../recurring/fakes';
import { newRecurringOwner, rentOf } from '../recurring/fixtures';

/** NFR-05: no stored notice carries an amount or an account name (FR-07). */
const ACCOUNT_NAME = 'Galicia';
// 350000.00 ARS in minor units, and the ways its digits can be written.
const AMOUNT = 35000000n;
const FORBIDDEN = ['35000000', '350000', '350.000', '350,000', ACCOUNT_NAME];
const LANGUAGES: NoticeLanguage[] = ['es', 'en'];

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

function forbiddenIn(text: string): string[] {
  return FORBIDDEN.filter((token) => text.includes(token));
}

describe('the sensitive-text check itself', () => {
  it('flags text with the amount digits or the account name and accepts a clean one', () => {
    expect(forbiddenIn('Luz vence en 3 días')).toEqual([]);
    expect(forbiddenIn('Luz 350000.00 vence')).toEqual(['350000']);
    expect(forbiddenIn('Luz en Galicia')).toEqual([ACCOUNT_NAME]);
  });
});

describe('renderNoticeText', () => {
  it.each(LANGUAGES)('never contains an amount or an account name in %s', (language) => {
    const texts = [
      renderNoticeText({
        kind: 'reminder',
        language,
        paymentName: 'Luz',
        dueDate: '2026-10-10',
        daysUntilDue: 3,
      }),
      renderNoticeText({ kind: 'recorded', language, paymentName: 'Luz', dueDate: '2026-10-05' }),
      renderNoticeText({
        kind: 'not_recorded',
        language,
        paymentName: 'Luz',
        dueDate: '2026-10-05',
      }),
    ];
    expect(texts).toHaveLength(3);
    for (const text of texts) expect(forbiddenIn(text)).toEqual([]);
  });
});

describe('stored notices over the real reminder and recording paths', () => {
  it.each(LANGUAGES)(
    'hold no amount and no account name in %s, for every kind',
    async (language) => {
      const owner = await newRecurringOwner(connection.db, connection.pool);
      await connection.pool.query('update users set language = $2 where id = $1', [
        owner.ownerId,
        language,
      ]);
      await connection.pool.query('update accounts set name = $2 where id = $1', [
        owner.accountId,
        ACCOUNT_NAME,
      ]);
      const payments = new DrizzleRecurringPaymentRepository(connection.db);
      const scope = await writeScopeFor(owner.ownerId);
      const common = {
        amount: AMOUNT,
        startDate: '2026-09-01',
        scheduleFrom: '2026-09-01',
        autoRecordingFrom: '2026-09-01',
      };
      // Due on the 10th, asking for confirmation: its reminder is due on the 7th.
      await payments.create(
        scope,
        rentOf(owner, { ...common, name: 'Luz', dayOfMonth: 10, mode: 'confirmation' }),
      );
      // Due on the 5th, automatic: one is recorded and one is refused by the recorder.
      const recordedName = 'Alquiler';
      const refusedName = 'Gimnasio';
      await payments.create(
        scope,
        rentOf(owner, { ...common, name: recordedName, dayOfMonth: 5, mode: 'automatic' }),
      );

      const clock = new FakeClock(new Date('2026-10-05T12:00:00.000Z'));
      const recorder = new FakeExpenseRecorder(clock);
      const failures: unknown[] = [];
      const publisher = createNoticePublisher(connection.db);
      const occurrences = new DrizzleOccurrenceRepository(connection.db);
      const recording = new RecordDueOccurrences({
        source: new DrizzleAutomaticPaymentSource(connection.db),
        occurrences,
        expenses: recorder,
        notices: publisher,
        clock,
        scopeFor: (ownerId) => writeScopeFor(ownerId),
        report: (failure) => failures.push(failure),
        info: () => undefined,
      });
      await recording.execute();

      // A second automatic payment whose expense the recorder refuses with a domain error.
      recorder.failWith = new AppError('MOVEMENT_DATE_IN_FUTURE');
      await payments.create(
        scope,
        rentOf(owner, { ...common, name: refusedName, dayOfMonth: 5, mode: 'automatic' }),
      );
      await recording.execute();
      recorder.failWith = null;

      clock.current = new Date('2026-10-07T12:00:00.000Z');
      await new CreateDueReminders({
        source: new DrizzleReminderPaymentSource(connection.db),
        occurrences,
        notices: publisher,
        clock,
        report: (failure) => failures.push(failure),
      }).execute();

      const stored = await connection.pool.query<{ kind: string; text: string }>(
        'select kind, text from notices where owner_id = $1 order by kind, text',
        [owner.ownerId],
      );
      expect(new Set(stored.rows.map((row) => row.kind))).toEqual(
        new Set(['reminder', 'recorded', 'not_recorded']),
      );
      expect(stored.rows.some((row) => row.text.includes(recordedName))).toBe(true);
      expect(stored.rows.some((row) => row.text.includes(refusedName))).toBe(true);
      for (const row of stored.rows) expect(forbiddenIn(row.text)).toEqual([]);
    },
  );
});
