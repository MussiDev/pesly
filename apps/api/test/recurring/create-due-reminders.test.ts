import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewRecurringPayment } from '../../src/recurring/application/ports/recurring-payment-repository';
import type {
  ReminderEntry,
  ReminderPaymentSource,
} from '../../src/recurring/application/ports/reminder-payment-source';
import {
  CreateDueReminders,
  type ReminderFailure,
} from '../../src/recurring/application/create-due-reminders';
import { RecordDueOccurrences } from '../../src/recurring/application/record-due-occurrences';
import { FakeNoticePublisher, recurringFakes, writeScopeFor } from './fakes';

const ANA = 'ana';
const BEA = 'bea';

const originalZone = process.env.TZ;
afterEach(() => {
  if (originalZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalZone;
});

function setup(now: string) {
  const fakes = recurringFakes(now);
  const failures: ReminderFailure[] = [];
  const reminders = (pageSize?: number, source?: ReminderPaymentSource) =>
    new CreateDueReminders({
      source: source ?? fakes.reminderSource,
      occurrences: fakes.occurrences,
      notices: fakes.notices,
      clock: fakes.clock,
      report: (failure) => failures.push(failure),
      ...(pageSize === undefined ? {} : { pageSize }),
    });
  return { ...fakes, failures, job: reminders(), reminders };
}

type App = ReturnType<typeof setup>;

/** Monthly on the 10th, asking for confirmation, 3 reminder days, created long before. */
async function addPayment(app: App, userId = ANA, overrides: Partial<NewRecurringPayment> = {}) {
  app.payments.own(userId, `account-${userId}`, `category-${userId}`);
  return app.payments.create(await writeScopeFor(userId), {
    name: 'Luz',
    amount: 35000000n,
    accountId: `account-${userId}`,
    categoryId: `category-${userId}`,
    frequency: 'monthly',
    weekday: null,
    dayOfMonth: 10,
    month: null,
    startDate: '2026-09-01',
    endDate: null,
    mode: 'confirmation',
    scheduleFrom: '2026-09-01',
    autoRecordingFrom: '2026-09-01',
    reminderDays: 3,
    ...overrides,
  });
}

describe('CreateDueReminders', () => {
  it('creates the reminder at 09:00 owner time on the reminder day and not at 08:59 (AC-04)', async () => {
    const app = setup('2026-10-07T11:59:00.000Z');
    const payment = await addPayment(app);

    await app.job.execute();
    expect(app.notices.published).toEqual([]);

    app.clock.current = new Date('2026-10-07T12:00:00.000Z');
    const summary = await app.job.execute();

    expect(app.notices.published).toEqual([
      {
        ownerId: ANA,
        kind: 'reminder',
        paymentId: payment.id,
        paymentName: 'Luz',
        dueDate: '2026-10-10',
        language: 'es',
        daysUntilDue: 3,
      },
    ]);
    expect(summary).toEqual({ payments: 1, reminders: 1, failed: 0 });
  });

  it('uses the owner language and a payment of any mode', async () => {
    const app = setup('2026-10-07T12:00:00.000Z');
    app.reminderSource.languages.set(BEA, 'en');
    await addPayment(app, ANA, { mode: 'automatic' });
    await addPayment(app, BEA);

    await app.job.execute();

    expect(app.notices.published.map((n) => [n.ownerId, n.language])).toEqual(
      expect.arrayContaining([
        [ANA, 'es'],
        [BEA, 'en'],
      ]),
    );
    expect(app.notices.published).toHaveLength(2);
  });

  it('Madrid 06:59 UTC creates nothing, 07:00 UTC creates it, whatever the process zone (AC-05)', async () => {
    process.env.TZ = 'Pacific/Auckland';
    const app = setup('2026-10-05T06:59:00.000Z');
    app.timeZones.byUser.set(ANA, 'Europe/Madrid');
    await addPayment(app, ANA, { dayOfMonth: 5, reminderDays: 0 });

    await app.job.execute();
    expect(app.notices.published).toEqual([]);

    app.clock.current = new Date('2026-10-05T07:00:00.000Z');
    await app.job.execute();

    expect(app.notices.published).toHaveLength(1);
    expect(app.notices.published[0]).toMatchObject({ dueDate: '2026-10-05', daysUntilDue: 0 });
  });

  it('a missed reminder day is created the next day, before the due date (AC-06)', async () => {
    const app = setup('2026-10-08T15:00:00.000Z');
    await addPayment(app);

    await app.job.execute();

    expect(app.notices.published).toHaveLength(1);
    expect(app.notices.published[0]).toMatchObject({ dueDate: '2026-10-10', daysUntilDue: 2 });
  });

  it('a due date that has passed gets no reminder (AC-07)', async () => {
    const app = setup('2026-10-11T15:00:00.000Z');
    await addPayment(app);

    await app.job.execute();

    expect(app.notices.published).toEqual([]);
  });

  it('no reminder for a day before the payment was created or resumed (AC-08)', async () => {
    const app = setup('2026-10-09T15:00:00.000Z');
    await addPayment(app, ANA, {
      dayOfMonth: 11,
      startDate: '2026-10-09',
      scheduleFrom: '2026-10-09',
      autoRecordingFrom: '2026-10-09',
    });
    await addPayment(app, BEA, {
      dayOfMonth: 11,
      startDate: '2026-10-09',
      scheduleFrom: '2026-10-09',
      autoRecordingFrom: '2026-10-08',
    });

    await app.job.execute();

    expect(app.notices.published.map((n) => n.ownerId)).toEqual([BEA]);
  });

  it('a paused payment gets no reminder (AC-09)', async () => {
    const app = setup('2026-10-08T15:00:00.000Z');
    const payment = await addPayment(app);
    await app.payments.setStatus(await writeScopeFor(ANA), payment.id, {
      status: 'paused',
      scheduleFrom: '2026-09-01',
    });

    await app.job.execute();

    expect(app.notices.published).toEqual([]);
  });

  it('confirmed, skipped and recorded occurrences get no reminder, a pending one does (AC-10)', async () => {
    const app = setup('2026-10-10T15:00:00.000Z');
    const scope = await writeScopeFor(ANA);
    const confirmed = await addPayment(app, ANA, { name: 'Confirmed' });
    const skipped = await addPayment(app, ANA, { name: 'Skipped' });
    const recorded = await addPayment(app, ANA, {
      name: 'Recorded',
      mode: 'automatic',
      autoRecordingFrom: '2026-10-01',
    });
    const pending = await addPayment(app, ANA, { name: 'Pending' });
    for (const payment of [confirmed, skipped]) {
      await app.occurrences.insertIgnore([
        { paymentId: payment.id, ownerId: ANA, dueDate: '2026-10-10' },
      ]);
    }
    const row = (id: string) =>
      app.occurrences.rows.find((item) => item.occurrence.paymentId === id)?.occurrence.id ?? '';
    await app.occurrences.withLockedPending(scope, row(confirmed.id), () =>
      Promise.resolve({ status: 'confirmed', confirmedAmount: 1n, movementId: 'm1' }),
    );
    await app.occurrences.withLockedPending(scope, row(skipped.id), () =>
      Promise.resolve({ status: 'skipped' }),
    );
    await new RecordDueOccurrences({
      ...app,
      // Its own publisher: the recorded notice of this job is not what the reminders are counted on.
      notices: new FakeNoticePublisher(),
      scopeFor: (ownerId) => writeScopeFor(ownerId),
      report: () => undefined,
      info: () => undefined,
    }).execute();
    expect(app.expenses.expenses.map((e) => e.note)).toEqual(['Recorded']);

    await app.job.execute();

    expect(app.notices.published.map((n) => n.paymentId)).toEqual([pending.id]);
    expect(recorded.id).not.toBe(pending.id);
  });

  it('a payment past its end date and a deleted payment get no reminder (AC-11)', async () => {
    const app = setup('2026-10-08T15:00:00.000Z');
    await addPayment(app, ANA, { endDate: '2026-10-09' });
    const deleted = await addPayment(app, BEA);
    await app.payments.delete(await writeScopeFor(BEA), deleted.id);

    await app.job.execute();

    expect(app.notices.published).toEqual([]);
  });

  it('editing the reminder days from 3 to 0 before the reminder day uses 0 (AC-03)', async () => {
    const app = setup('2026-10-05T15:00:00.000Z');
    const payment = await addPayment(app);
    await app.payments.update(await writeScopeFor(ANA), payment.id, { reminderDays: 0 });

    await app.job.execute();
    expect(app.notices.published).toEqual([]);

    // The old 3-day reminder day (10-07) has passed: with 3 days a catch-up would create it now.
    app.clock.current = new Date('2026-10-08T12:00:00.000Z');
    await app.job.execute();
    expect(app.notices.published).toEqual([]);

    app.clock.current = new Date('2026-10-10T12:00:00.000Z');
    await app.job.execute();

    expect(app.notices.published).toHaveLength(1);
    expect(app.notices.published[0]).toMatchObject({ dueDate: '2026-10-10', daysUntilDue: 0 });
  });

  it('three passes over the same reminder hold one notice (AC-23)', async () => {
    const app = setup('2026-10-07T12:00:00.000Z');
    await addPayment(app);

    const first = await app.job.execute();
    const second = await app.job.execute();
    await app.job.execute();

    expect(first.reminders).toBe(1);
    expect(second.reminders).toBe(0);
    expect(app.notices.published).toHaveLength(1);
  });

  it('a time zone change to Asia/Tokyo creates the reminder at 09:00 Tokyo time (AC-26)', async () => {
    const app = setup('2026-10-09T23:00:00.000Z');
    await addPayment(app, ANA, { reminderDays: 0 });

    await app.job.execute();
    expect(app.notices.published).toEqual([]);

    app.timeZones.byUser.set(ANA, 'Asia/Tokyo');
    app.clock.current = new Date('2026-10-09T23:59:00.000Z');
    await app.job.execute();
    expect(app.notices.published).toEqual([]);

    app.clock.current = new Date('2026-10-10T00:00:00.000Z');
    await app.job.execute();
    expect(app.notices.published).toHaveLength(1);
  });

  it('with a pass every 60 s the reminder appears between 09:00 and 09:15 local (NFR-01)', async () => {
    const app = setup('2026-10-07T11:50:00.000Z');
    await addPayment(app);
    let createdAt: Date | null = null;

    for (let step = 0; step < 40 && createdAt === null; step++) {
      await app.job.execute();
      if (app.notices.published.length > 0) createdAt = app.clock.now();
      else app.clock.current = new Date(app.clock.now().getTime() + 60_000);
    }

    // Buenos Aires is UTC-3: 09:00 local is 12:00 UTC.
    expect(createdAt?.toISOString()).toBe('2026-10-07T12:00:00.000Z');
    expect(createdAt && createdAt.getTime() - Date.parse('2026-10-07T12:00:00.000Z')).toBeLessThan(
      15 * 60_000,
    );
  });

  it('reads the payments by keyset pages, one resolved lookup and one insert per page', async () => {
    const app = setup('2026-10-07T12:00:00.000Z');
    for (let i = 0; i < 5; i++) await addPayment(app, ANA, { name: `Pay ${i}` });
    const resolved = vi.spyOn(app.occurrences, 'listResolvedDueDates');

    const summary = await app.reminders(2).execute();

    expect(summary).toEqual({ payments: 5, reminders: 5, failed: 0 });
    expect(resolved).toHaveBeenCalledTimes(3);
    expect(app.notices.manyCalls.map((call) => call.length)).toEqual([2, 2, 1]);
    expect(app.reminderSource.calls[0]).toBeNull();
    expect(app.reminderSource.calls).toHaveLength(3);
  });
});

describe('CreateDueReminders errors', () => {
  it('an error in one payment is reported with ids only and the others still get theirs (AC-25)', async () => {
    const app = setup('2026-10-07T12:00:00.000Z');
    const bad = await addPayment(app, ANA, { name: 'Secret name' });
    const good = await addPayment(app, BEA);
    const broken = Object.defineProperty({ ...bad }, 'reminderDays', {
      get: (): number => {
        throw new TypeError('amount 35000000 Secret name');
      },
    });
    const source: ReminderPaymentSource = {
      page: (afterId) =>
        Promise.resolve(
          afterId === null
            ? ([
                { ownerId: ANA, timeZone: 'America/Cordoba', language: 'es', payment: broken },
                { ownerId: BEA, timeZone: 'America/Cordoba', language: 'es', payment: good },
              ] satisfies ReminderEntry[])
            : [],
        ),
    };

    const summary = await app.reminders(undefined, source).execute();

    expect(app.notices.published.map((n) => n.paymentId)).toEqual([good.id]);
    expect(summary.failed).toBe(1);
    expect(app.failures).toEqual([{ paymentId: bad.id, afterId: null, errorName: 'TypeError' }]);
    expect(JSON.stringify(app.failures)).not.toMatch(/35000000|Secret/);
  });

  it('an error of the page insert is reported and the next page still runs (AC-25)', async () => {
    const app = setup('2026-10-07T12:00:00.000Z');
    await addPayment(app, ANA);
    await addPayment(app, BEA);
    app.notices.failNextMany = new RangeError('connection terminated');

    const summary = await app.reminders(1).execute();

    expect(app.failures).toEqual([{ paymentId: null, afterId: null, errorName: 'RangeError' }]);
    expect(app.notices.published).toHaveLength(1);
    expect(summary.failed).toBe(1);

    // The reminders of the failed page are retried on the next pass.
    await app.reminders(1).execute();
    expect(app.notices.published).toHaveLength(2);
  });

  it('a storage failure while reading a page rejects the pass (AC-25)', async () => {
    const app = setup('2026-10-07T12:00:00.000Z');
    const source: ReminderPaymentSource = {
      page: () => Promise.reject(new Error('connection terminated')),
    };

    await expect(app.reminders(undefined, source).execute()).rejects.toThrow(
      'connection terminated',
    );
  });
});
