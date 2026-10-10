import { AppError } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { ConfirmOccurrence } from '../../src/recurring/application/confirm-occurrence';
import { CreateRecurringPayment } from '../../src/recurring/application/create-recurring-payment';
import { ListUpcoming } from '../../src/recurring/application/list-upcoming';
import { MaterializeOccurrences } from '../../src/recurring/application/materialize-occurrences';
import { PauseRecurringPayment } from '../../src/recurring/application/pause-recurring-payment';
import type { NewRecurringPayment } from '../../src/recurring/application/ports/recurring-payment-repository';
import {
  RecordDueOccurrences,
  type RecordFailure,
  type RecordInfo,
} from '../../src/recurring/application/record-due-occurrences';
import { ResumeRecurringPayment } from '../../src/recurring/application/resume-recurring-payment';
import { OccurrenceNotPending } from '../../src/recurring/domain/errors';
import { ResourceNotFound } from '../../src/shared/access';
import { readScopeFor, recurringFakes, writeScopeFor } from './fakes';

const ANA = 'ana';
const BEA = 'bea';
const CAI = 'cai';
const RENT = 35000000n;

function setup(now = '2026-10-05T12:00:00.000Z') {
  const fakes = recurringFakes(now);
  const failures: RecordFailure[] = [];
  const infos: RecordInfo[] = [];
  const jobWithPageSize = (pageSize?: number) =>
    new RecordDueOccurrences({
      ...fakes,
      scopeFor: (ownerId) => writeScopeFor(ownerId),
      report: (failure) => failures.push(failure),
      info: (info) => infos.push(info),
      ...(pageSize === undefined ? {} : { pageSize }),
    });
  return {
    ...fakes,
    failures,
    infos,
    job: jobWithPageSize(),
    jobWithPageSize,
    upcoming: new ListUpcoming(fakes),
    materialize: new MaterializeOccurrences(fakes),
    confirm: new ConfirmOccurrence(fakes),
    create: new CreateRecurringPayment(fakes),
    pause: new PauseRecurringPayment(fakes),
    resume: new ResumeRecurringPayment(fakes),
  };
}

type App = ReturnType<typeof setup>;

/** An active automatic "Rent" due on the 5th, recording from its first due date by default. */
async function addPayment(app: App, userId = ANA, overrides: Partial<NewRecurringPayment> = {}) {
  app.payments.own(userId, `account-${userId}`, `category-${userId}`);
  return app.payments.create(await writeScopeFor(userId), {
    name: 'Rent',
    amount: RENT,
    accountId: `account-${userId}`,
    categoryId: `category-${userId}`,
    frequency: 'monthly',
    weekday: null,
    dayOfMonth: 5,
    month: null,
    startDate: '2026-10-05',
    endDate: null,
    mode: 'automatic',
    scheduleFrom: '2026-10-05',
    autoRecordingFrom: '2026-10-05',
    ...overrides,
  });
}

const statusesOf = (app: App) =>
  app.occurrences.rows.map((row) => `${row.occurrence.dueDate}:${row.occurrence.status}`);

describe('RecordDueOccurrences', () => {
  it('records an expense for a due occurrence and resolves it linked to the movement (AC-01)', async () => {
    const app = setup();
    const payment = await addPayment(app);

    const summary = await app.job.execute();

    expect(app.expenses.expenses).toHaveLength(1);
    expect(app.expenses.expenses[0]).toMatchObject({
      ownerId: ANA,
      accountId: 'account-ana',
      categoryId: 'category-ana',
      amount: RENT,
    });
    const occurrence = app.occurrences.rows[0]?.occurrence;
    expect(occurrence).toMatchObject({
      paymentId: payment.id,
      dueDate: '2026-10-05',
      status: 'confirmed',
      confirmedAmount: RENT,
      movementId: app.expenses.expenses[0]?.id,
    });
    expect(app.expenses.expenses[0]?.id).toBe(occurrence?.id);
    expect(summary).toEqual({
      payments: 1,
      recorded: 1,
      skippedAlreadyResolved: 0,
      skippedMissing: 0,
      failed: 0,
    });
  });

  it('Madrid 03:59 UTC records nothing, 04:00 UTC records (AC-02)', async () => {
    const app = setup('2026-10-05T03:59:00.000Z');
    app.timeZones.zone = 'Europe/Madrid';
    app.expenses.zone = 'Europe/Madrid';
    await addPayment(app);

    await app.job.execute();
    expect(app.expenses.expenses).toHaveLength(0);

    app.clock.current = new Date('2026-10-05T04:00:00.000Z');
    await app.job.execute();
    expect(app.expenses.expenses).toHaveLength(1);
  });

  it('archived account leaves the occurrence pending and listed (AC-03)', async () => {
    const app = setup();
    await addPayment(app);
    app.expenses.failWith = new AppError('ACCOUNT_ARCHIVED');

    const summary = await app.job.execute();

    expect(summary.failed).toBe(1);
    expect(app.expenses.expenses).toHaveLength(0);
    expect(statusesOf(app)).toEqual(['2026-10-05:pending']);
    const items = await app.upcoming.execute(await readScopeFor(ANA));
    expect(items.filter((item) => item.occurrenceId !== null)).toMatchObject([
      { kind: 'pending', dueDate: '2026-10-05' },
    ]);
  });

  it('confirming a pending left by the job records exactly one expense (AC-04)', async () => {
    const app = setup();
    await addPayment(app);
    app.expenses.failWith = new AppError('ACCOUNT_ARCHIVED');
    await app.job.execute();
    app.expenses.failWith = null;
    const [pending] = await app.upcoming.execute(await readScopeFor(ANA));

    await app.confirm.execute(await writeScopeFor(ANA), pending?.occurrenceId ?? 'missing');
    await app.job.execute();

    expect(app.expenses.expenses).toHaveLength(1);
    expect(statusesOf(app)).toEqual(['2026-10-05:confirmed']);
  });

  it('three missed dates are recorded on the next run with their own dates (AC-05)', async () => {
    const app = setup('2026-10-05T12:00:00.000Z');
    await addPayment(app, ANA, {
      frequency: 'weekly',
      weekday: 0,
      dayOfMonth: null,
      startDate: '2026-09-21',
      scheduleFrom: '2026-09-21',
      autoRecordingFrom: '2026-09-21',
    });

    await app.job.execute();

    expect(app.expenses.expenses.map((e) => e.occurredAt.toISOString()).sort()).toEqual([
      '2026-09-21T15:00:00.000Z',
      '2026-09-28T15:00:00.000Z',
      '2026-10-05T15:00:00.000Z',
    ]);
  });

  it('due dates before autoRecordingFrom stay pending and record nothing (AC-06)', async () => {
    const app = setup('2026-10-09T15:00:00.000Z');
    await addPayment(app, ANA, {
      dayOfMonth: 1,
      startDate: '2026-09-01',
      scheduleFrom: '2026-09-01',
      autoRecordingFrom: '2026-10-09',
    });

    await app.job.execute();

    expect(app.expenses.expenses).toHaveLength(0);
    expect(statusesOf(app)).toEqual(['2026-09-01:pending', '2026-10-01:pending']);
  });

  it('a resumed payment records nothing for the paused interval (AC-07)', async () => {
    const app = setup('2026-08-20T15:00:00.000Z');
    app.payments.own(ANA, 'account-ana', 'category-ana');
    const created = await app.create.execute(await writeScopeFor(ANA), {
      name: 'Rent',
      amount: RENT,
      accountId: 'account-ana',
      categoryId: 'category-ana',
      frequency: 'monthly',
      dayOfMonth: 20,
      startDate: '2026-08-20',
      mode: 'automatic',
    });
    app.clock.current = new Date('2026-09-10T15:00:00.000Z');
    await app.pause.execute(await writeScopeFor(ANA), created.id);
    app.clock.current = new Date('2026-10-25T15:00:00.000Z');
    await app.resume.execute(await writeScopeFor(ANA), created.id);

    await app.job.execute();

    expect(app.expenses.expenses).toHaveLength(0);
    expect(app.occurrences.rows).toHaveLength(0);
  });

  it('three runs in a row leave one expense per occurrence (AC-08)', async () => {
    const app = setup();
    await addPayment(app);

    await app.job.execute();
    await app.job.execute();
    const third = await app.job.execute();

    expect(app.expenses.expenses).toHaveLength(1);
    expect(third.recorded).toBe(0);
  });

  it('a crash after the expense and before the resolution links the existing expense (AC-10)', async () => {
    const app = setup();
    await addPayment(app);
    const original = app.occurrences.withLockedPending.bind(app.occurrences);
    app.occurrences.withLockedPending = async (_scope, _id, fn) => {
      const row = app.occurrences.rows[0];
      if (row) await fn(row.occurrence);
      throw new Error('process killed');
    };

    await app.job.execute();
    expect(app.expenses.expenses).toHaveLength(1);
    expect(statusesOf(app)).toEqual(['2026-10-05:pending']);
    app.occurrences.withLockedPending = original;
    await app.job.execute();

    expect(app.expenses.expenses).toHaveLength(1);
    expect(app.occurrences.rows[0]?.occurrence).toMatchObject({
      status: 'confirmed',
      movementId: app.expenses.expenses[0]?.id,
    });
  });

  it('paused, ended and deleted payments record nothing (AC-11)', async () => {
    const app = setup('2026-09-05T12:00:00.000Z');
    const dates = {
      startDate: '2026-09-05',
      scheduleFrom: '2026-09-05',
      autoRecordingFrom: '2026-09-05',
    };
    const paused = await addPayment(app, ANA, dates);
    await app.payments.setStatus(await writeScopeFor(ANA), paused.id, {
      status: 'paused',
      scheduleFrom: '2026-09-05',
    });
    const deleted = await addPayment(app, BEA, dates);
    await app.payments.delete(await writeScopeFor(BEA), deleted.id);
    await addPayment(app, CAI, { ...dates, endDate: '2026-09-05' });

    await app.job.execute();
    expect(app.expenses.expenses.map((e) => e.ownerId)).toEqual([CAI]);

    app.clock.current = new Date('2026-12-05T12:00:00.000Z');
    await app.job.execute();
    expect(app.expenses.expenses).toHaveLength(1);
  });

  it('one failing payment among three does not stop the others and is retried (AC-12)', async () => {
    const app = setup();
    for (const id of [ANA, BEA, CAI]) await addPayment(app, id);
    const original = app.expenses.recordOnce.bind(app.expenses);
    let broken = true;
    app.expenses.recordOnce = (scope, id, expense) =>
      broken && expense.accountId === 'account-bea'
        ? Promise.reject(new AppError('RATE_REQUIRED'))
        : original(scope, id, expense);

    const first = await app.job.execute();

    expect(first).toMatchObject({ payments: 3, recorded: 2, failed: 1 });
    expect(app.expenses.expenses.map((e) => e.ownerId).sort()).toEqual([ANA, CAI]);
    expect(app.failures).toHaveLength(1);
    expect(Object.keys(app.failures[0] ?? {}).sort()).toEqual([
      'errorName',
      'occurrenceId',
      'paymentId',
    ]);
    expect(JSON.stringify(app.failures)).not.toMatch(/Rent|35000000|account-|category-/);

    broken = false;
    await app.job.execute();
    expect(app.expenses.expenses).toHaveLength(3);
  });

  it('a zone change from Buenos Aires to Tokyo moves the due time (AC-13)', async () => {
    const app = setup('2026-10-04T20:59:00.000Z');
    await addPayment(app, ANA, { autoRecordingFrom: '2026-10-04' });
    app.timeZones.zone = 'Asia/Tokyo';
    app.expenses.zone = 'Asia/Tokyo';

    await app.job.execute();
    expect(app.expenses.expenses).toHaveLength(0);

    app.clock.current = new Date('2026-10-04T21:00:00.000Z');
    await app.job.execute();
    expect(app.expenses.expenses).toHaveLength(1);
  });

  it('the recorded occurrence leaves upcoming payments (AC-14)', async () => {
    const app = setup();
    await addPayment(app);
    await app.job.execute();

    const items = await app.upcoming.execute(await readScopeFor(ANA));

    expect(items.filter((item) => item.occurrenceId !== null)).toEqual([]);
    expect(items.every((item) => item.kind === 'scheduled')).toBe(true);
  });

  it('sad path: OccurrenceNotPending is counted as already resolved and raises nothing', async () => {
    const app = setup();
    await addPayment(app);
    app.occurrences.withLockedPending = () => Promise.reject(new OccurrenceNotPending());

    const summary = await app.job.execute();

    expect(summary).toMatchObject({ skippedAlreadyResolved: 1, skippedMissing: 0, failed: 0 });
    expect(app.failures).toEqual([]);
  });

  it('sad path: ResourceNotFound from recordOnce is reported as a failure with ids only', async () => {
    const app = setup();
    const payment = await addPayment(app);
    app.expenses.recordOnce = () => Promise.reject(new ResourceNotFound());

    const summary = await app.job.execute();

    expect(summary).toMatchObject({ failed: 1, skippedMissing: 0 });
    expect(app.failures).toEqual([
      {
        paymentId: payment.id,
        occurrenceId: app.occurrences.rows[0]?.occurrence.id,
        errorName: 'ResourceNotFound',
      },
    ]);
    expect(app.infos).toEqual([]);
  });

  it('sad path: ResourceNotFound from withLockedPending is counted as missing and logged at info level', async () => {
    const app = setup();
    const payment = await addPayment(app);
    app.occurrences.withLockedPending = () => Promise.reject(new ResourceNotFound());

    const summary = await app.job.execute();

    expect(summary).toMatchObject({ skippedMissing: 1, failed: 0 });
    expect(app.failures).toEqual([]);
    expect(app.infos).toEqual([
      {
        event: 'occurrence-missing',
        paymentId: payment.id,
        occurrenceId: app.occurrences.rows[0]?.occurrence.id,
      },
    ]);
  });

  it('the movement is dated at noon of the due date in the owner zone, not at the run time', async () => {
    const app = setup('2026-10-05T23:30:00.000Z');
    app.timeZones.zone = 'Asia/Tokyo';
    app.expenses.zone = 'Asia/Tokyo';
    await addPayment(app);

    await app.job.execute();

    expect(app.expenses.expenses[0]?.occurredAt.toISOString()).toBe('2026-10-05T03:00:00.000Z');
  });

  it('sad path: a missing exchange rate or a rate limit leaves the occurrence pending and retried (AC-12)', async () => {
    const app = setup();
    await addPayment(app);

    for (const code of ['RATE_REQUIRED', 'RATE_LIMITED'] as const) {
      app.expenses.failWith = new AppError(code);
      await app.job.execute();
      expect(statusesOf(app)).toEqual(['2026-10-05:pending']);
    }
    expect(app.failures).toHaveLength(2);

    app.expenses.failWith = null;
    await app.job.execute();
    expect(statusesOf(app)).toEqual(['2026-10-05:confirmed']);
    expect(app.expenses.expenses).toHaveLength(1);
  });

  it('sad path: a zone name the runtime rejects falls back to the stored default zone', async () => {
    const app = setup('2026-10-05T08:59:00.000Z');
    app.timeZones.zone = 'Not/AZone';
    await addPayment(app);

    await app.job.execute();
    expect(app.expenses.expenses).toHaveLength(0);

    app.clock.current = new Date('2026-10-05T09:00:00.000Z');
    await app.job.execute();
    expect(app.expenses.expenses).toHaveLength(1);
  });

  it('walks every page of the source by keyset', async () => {
    const app = setup();
    for (const id of [ANA, BEA, CAI]) await addPayment(app, id);

    const summary = await app.jobWithPageSize(1).execute();

    expect(summary).toMatchObject({ payments: 3, recorded: 3 });
  });
});

describe('MaterializeOccurrences for automatic payments (FR-05)', () => {
  it('creates pending rows only before autoRecordingFrom', async () => {
    const app = setup('2026-10-05T12:00:00.000Z');
    await addPayment(app, ANA, {
      startDate: '2026-08-05',
      scheduleFrom: '2026-08-05',
      autoRecordingFrom: '2026-10-05',
    });

    await app.materialize.execute(await readScopeFor(ANA));

    expect(statusesOf(app)).toEqual(['2026-08-05:pending', '2026-09-05:pending']);
  });

  it('keeps materializing every due date of a confirmation payment', async () => {
    const app = setup('2026-10-05T12:00:00.000Z');
    await addPayment(app, ANA, { mode: 'confirmation', autoRecordingFrom: '2026-10-05' });

    await app.materialize.execute(await readScopeFor(ANA));

    expect(statusesOf(app)).toEqual(['2026-10-05:pending']);
  });
});
