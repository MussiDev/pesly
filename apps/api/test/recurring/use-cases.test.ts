import { AppError } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { ConfirmOccurrence } from '../../src/recurring/application/confirm-occurrence';
import {
  CreateRecurringPayment,
  type CreateRecurringPaymentInput,
} from '../../src/recurring/application/create-recurring-payment';
import { DeleteRecurringPayment } from '../../src/recurring/application/delete-recurring-payment';
import { ListUpcoming } from '../../src/recurring/application/list-upcoming';
import {
  GetRecurringPayment,
  ListRecurringPayments,
} from '../../src/recurring/application/list-recurring-payments';
import { MaterializeOccurrences } from '../../src/recurring/application/materialize-occurrences';
import { PauseRecurringPayment } from '../../src/recurring/application/pause-recurring-payment';
import { ResumeRecurringPayment } from '../../src/recurring/application/resume-recurring-payment';
import { SkipOccurrence } from '../../src/recurring/application/skip-occurrence';
import { UpdateRecurringPayment } from '../../src/recurring/application/update-recurring-payment';
import { OccurrenceNotPending, RecurringLimitReached } from '../../src/recurring/domain/errors';
import { ResourceNotFound } from '../../src/shared/access';
import { readScopeFor, recurringFakes, writeScopeFor } from './fakes';

const ANA = 'ana';
const BEA = 'bea';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

function setup(now = '2026-10-09T15:00:00.000Z') {
  const fakes = recurringFakes(now);
  const deps = { ...fakes };
  return {
    ...fakes,
    create: new CreateRecurringPayment(deps),
    update: new UpdateRecurringPayment(deps),
    pause: new PauseRecurringPayment(deps),
    resume: new ResumeRecurringPayment(deps),
    remove: new DeleteRecurringPayment(deps),
    list: new ListRecurringPayments(deps),
    get: new GetRecurringPayment(deps),
    materialize: new MaterializeOccurrences(deps),
    upcoming: new ListUpcoming(deps),
    confirm: new ConfirmOccurrence(deps),
    skip: new SkipOccurrence(deps),
  };
}

type App = ReturnType<typeof setup>;

const rent: CreateRecurringPaymentInput = {
  name: 'Rent',
  amount: 35000000n,
  accountId: 'account-ana',
  categoryId: 'category-ana',
  frequency: 'monthly',
  dayOfMonth: 5,
  startDate: '2026-10-05',
  mode: 'confirmation',
};

async function createFor(
  app: App,
  userId: string,
  overrides: Partial<CreateRecurringPaymentInput> = {},
) {
  app.payments.own(userId, `account-${userId}`, `category-${userId}`);
  return app.create.execute(await writeScopeFor(userId), {
    ...rent,
    accountId: `account-${userId}`,
    categoryId: `category-${userId}`,
    ...overrides,
  });
}

/** The single pending occurrence id of the user, after materializing. */
async function firstOccurrenceId(app: App, userId = ANA): Promise<string> {
  const items = await app.upcoming.execute(await readScopeFor(userId));
  const item = items.find((entry) => entry.occurrenceId !== null);
  if (!item?.occurrenceId) throw new Error('No materialized occurrence');
  return item.occurrenceId;
}

describe('auto-recording start day (AC-06, AC-07, FR-05)', () => {
  it('a new payment stores today in the owner zone, not the start date or the UTC day (AC-06)', async () => {
    const app = setup('2026-10-09T02:00:00.000Z');

    const past = await createFor(app, ANA, { mode: 'automatic', startDate: '2026-09-01' });
    app.timeZones.zone = 'Asia/Tokyo';
    const tokyo = await createFor(app, BEA, { mode: 'automatic', startDate: '2026-09-01' });

    expect(past).toMatchObject({ scheduleFrom: '2026-09-01', autoRecordingFrom: '2026-10-08' });
    expect(tokyo.autoRecordingFrom).toBe('2026-10-09');
  });

  it('switching confirmation to automatic sets the field to today (AC-06)', async () => {
    const app = setup('2026-10-09T15:00:00.000Z');
    const payment = await createFor(app, ANA);
    expect(payment.autoRecordingFrom).toBe('2026-10-09');
    app.clock.current = new Date('2026-10-20T15:00:00.000Z');

    const updated = await app.update.execute(await writeScopeFor(ANA), payment.id, {
      mode: 'automatic',
    });

    expect(updated).toMatchObject({ mode: 'automatic', autoRecordingFrom: '2026-10-20' });
  });

  it('a schedule edit moves the field to today and a plain edit keeps it', async () => {
    const app = setup('2026-10-09T15:00:00.000Z');
    const payment = await createFor(app, ANA, { mode: 'automatic' });
    const scope = await writeScopeFor(ANA);
    app.clock.current = new Date('2026-10-20T15:00:00.000Z');

    const renamed = await app.update.execute(scope, payment.id, { name: 'Rent 2', amount: 1n });
    const stillAutomatic = await app.update.execute(scope, payment.id, { mode: 'automatic' });
    const rescheduled = await app.update.execute(scope, payment.id, { dayOfMonth: 7 });

    expect(renamed.autoRecordingFrom).toBe('2026-10-09');
    expect(stillAutomatic.autoRecordingFrom).toBe('2026-10-09');
    expect(rescheduled.autoRecordingFrom).toBe('2026-10-20');
  });

  it('sad path: resume and setStatus on another owner payment raise ResourceNotFound and change nothing', async () => {
    const app = setup('2026-10-09T15:00:00.000Z');
    const payment = await createFor(app, ANA, { mode: 'automatic' });

    await expect(app.resume.execute(await writeScopeFor(BEA), payment.id)).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    await expect(
      app.payments.setStatus(await writeScopeFor(BEA), payment.id, {
        status: 'paused',
        scheduleFrom: '2026-10-09',
      }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(app.payments.rows[0]?.payment).toMatchObject({
      status: 'active',
      autoRecordingFrom: '2026-10-09',
    });
  });
});

describe('CreateRecurringPayment and ListUpcoming (AC-01)', () => {
  it('stores the payment and shows its next occurrence as scheduled', async () => {
    const app = setup('2026-10-01T15:00:00.000Z');

    const payment = await createFor(app, ANA);
    const items = await app.upcoming.execute(await readScopeFor(ANA));

    expect(payment).toMatchObject({ name: 'Rent', status: 'active', scheduleFrom: '2026-10-05' });
    expect(items).toEqual([
      {
        kind: 'scheduled',
        dueDate: '2026-10-05',
        paymentId: payment.id,
        name: 'Rent',
        amount: 35000000n,
        accountId: 'account-ana',
        categoryId: 'category-ana',
        occurrenceId: null,
      },
    ]);
  });

  it('clears the schedule fields that do not belong to the frequency', async () => {
    const app = setup();

    const payment = await createFor(app, ANA, {
      frequency: 'weekly',
      weekday: 0,
      dayOfMonth: 5,
      month: 3,
    });

    expect(payment).toMatchObject({ weekday: 0, dayOfMonth: null, month: null });
  });

  it('sad path: another user account or category stores nothing (AC-02)', async () => {
    const app = setup();
    app.payments.own(ANA, 'account-ana', 'category-ana');
    app.payments.own(BEA, 'account-bea', 'category-bea');
    const scope = await writeScopeFor(ANA);

    await expect(
      app.create.execute(scope, { ...rent, accountId: 'account-bea' }),
    ).rejects.toThrow();
    await expect(
      app.create.execute(scope, { ...rent, categoryId: 'category-bea' }),
    ).rejects.toThrow();

    expect(await app.payments.count(scope)).toBe(0);
  });

  it('sad path: the 201st payment is refused (AC-02)', async () => {
    const app = setup();
    for (let index = 0; index < 200; index++) await createFor(app, ANA);

    await expect(createFor(app, ANA)).rejects.toBeInstanceOf(RecurringLimitReached);
    expect(await app.payments.count(await readScopeFor(ANA))).toBe(200);
    expect(await createFor(app, BEA)).toMatchObject({ name: 'Rent' });
  });
});

describe('ListUpcoming materialization (AC-06, AC-11, AC-16)', () => {
  it('holds one pending occurrence after two calls and never touches the recorder', async () => {
    const app = setup('2026-10-05T15:00:00.000Z');
    await createFor(app, ANA);
    const scope = await readScopeFor(ANA);

    await app.upcoming.execute(scope);
    const items = await app.upcoming.execute(scope);

    expect(items.filter((item) => item.kind === 'pending')).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'pending', dueDate: '2026-10-05' });
    expect(app.occurrences.rows).toHaveLength(1);
    expect(app.expenses.expenses).toHaveLength(0);
  });

  it('only projects a payment due in the future and lists 30 days ahead but not 31', async () => {
    const app = setup();
    await createFor(app, ANA, {
      name: 'Insurance',
      frequency: 'yearly',
      month: 11,
      dayOfMonth: 9,
      startDate: '2026-01-01',
    });
    await createFor(app, ANA, {
      name: 'Tax',
      frequency: 'yearly',
      month: 11,
      dayOfMonth: 8,
      startDate: '2026-01-01',
      mode: 'automatic',
    });
    await createFor(app, ANA, { name: 'Gym', dayOfMonth: 15, startDate: '2026-10-09' });

    const items = await app.upcoming.execute(await readScopeFor(ANA));

    expect(items.map((item) => [item.name, item.kind, item.dueDate])).toEqual([
      ['Gym', 'scheduled', '2026-10-15'],
      ['Tax', 'scheduled', '2026-11-08'],
    ]);
    expect(app.occurrences.rows).toHaveLength(0);
  });

  it('does not materialize automatic payments', async () => {
    const app = setup('2026-10-05T15:00:00.000Z');
    await createFor(app, ANA, { mode: 'automatic' });

    await app.materialize.execute(await readScopeFor(ANA));

    expect(app.occurrences.rows).toHaveLength(0);
  });

  it('looks back at most 366 days', async () => {
    const app = setup();
    await createFor(app, ANA, { startDate: '2020-01-05' });

    await app.materialize.execute(await readScopeFor(ANA));

    const dates = app.occurrences.rows.map((row) => row.occurrence.dueDate).sort();
    expect(dates[0]).toBe('2025-11-05');
    expect(dates).toHaveLength(12);
  });

  it('uses the user zone: Asia/Tokyo at 16:30 UTC on 2026-10-31 is already 2026-11-01', async () => {
    const app = setup('2026-10-31T16:30:00.000Z');
    app.timeZones.zone = 'Asia/Tokyo';
    await createFor(app, ANA, { dayOfMonth: 1, startDate: '2026-11-01' });

    const items = await app.upcoming.execute(await readScopeFor(ANA));

    expect(items.filter((item) => item.kind === 'pending')).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'pending', dueDate: '2026-11-01' });
  });

  it('keeps the same instant as scheduled in Buenos Aires (still 2026-10-31)', async () => {
    const app = setup('2026-10-31T16:30:00.000Z');
    await createFor(app, ANA, { dayOfMonth: 1, startDate: '2026-11-01' });

    const items = await app.upcoming.execute(await readScopeFor(ANA));

    expect(items[0]).toMatchObject({ kind: 'scheduled', dueDate: '2026-11-01' });
  });
});

describe('ConfirmOccurrence (AC-07, AC-08)', () => {
  it('records the expense with the given amount and marks the occurrence confirmed', async () => {
    const app = setup('2026-10-05T15:00:00.000Z');
    await createFor(app, ANA);
    const id = await firstOccurrenceId(app);

    const result = await app.confirm.execute(await writeScopeFor(ANA), id, { amount: 4825000n });

    expect(app.expenses.expenses).toHaveLength(1);
    expect(app.expenses.expenses[0]).toMatchObject({
      accountId: 'account-ana',
      categoryId: 'category-ana',
      amount: 4825000n,
      rate: { source: 'automatic' },
      occurredAt: new Date('2026-10-05T15:00:00.000Z'),
    });
    expect(result).toMatchObject({
      status: 'confirmed',
      confirmedAmount: 4825000n,
      movementId: app.expenses.expenses[0]?.id,
    });
    expect(result.resolvedAt).toBeInstanceOf(Date);
    expect(await app.upcoming.execute(await readScopeFor(ANA))).toEqual([]);
  });

  it('defaults the amount to the payment amount and the date to the due date, at noon in the zone', async () => {
    const app = setup('2026-10-06T15:00:00.000Z');
    app.timeZones.zone = 'Asia/Tokyo';
    await createFor(app, ANA);
    const id = await firstOccurrenceId(app);

    await app.confirm.execute(await writeScopeFor(ANA), id);

    expect(app.expenses.expenses[0]).toMatchObject({
      amount: 35000000n,
      occurredAt: new Date('2026-10-05T03:00:00.000Z'),
    });
  });

  it('uses the given date', async () => {
    const app = setup('2026-10-09T15:00:00.000Z');
    await createFor(app, ANA);
    const id = await firstOccurrenceId(app);

    await app.confirm.execute(await writeScopeFor(ANA), id, { date: '2026-10-07' });

    expect(app.expenses.expenses[0]?.occurredAt).toEqual(new Date('2026-10-07T15:00:00.000Z'));
  });

  it('sad path: a confirmed or skipped occurrence raises OccurrenceNotPending and records nothing', async () => {
    const app = setup('2026-11-09T15:00:00.000Z');
    await createFor(app, ANA);
    const scope = await writeScopeFor(ANA);
    const [first, second] = (await app.upcoming.execute(scope)).map((item) => item.occurrenceId);
    if (!first || !second) throw new Error('Expected two occurrences');
    await app.confirm.execute(scope, first);
    await app.skip.execute(scope, second);

    await expect(app.confirm.execute(scope, first)).rejects.toBeInstanceOf(OccurrenceNotPending);
    await expect(app.confirm.execute(scope, second)).rejects.toBeInstanceOf(OccurrenceNotPending);
    await expect(app.skip.execute(scope, first)).rejects.toBeInstanceOf(OccurrenceNotPending);

    expect(app.expenses.expenses).toHaveLength(1);
  });

  it('sad path: a recorder rejection propagates unchanged and leaves the occurrence pending', async () => {
    const app = setup('2026-10-05T15:00:00.000Z');
    await createFor(app, ANA);
    const id = await firstOccurrenceId(app);
    const scope = await writeScopeFor(ANA);
    app.expenses.failWith = new AppError('ACCOUNT_ARCHIVED');

    await expect(app.confirm.execute(scope, id)).rejects.toMatchObject({
      code: 'ACCOUNT_ARCHIVED',
    });

    expect(app.occurrences.rows[0]?.occurrence).toMatchObject({
      status: 'pending',
      movementId: null,
      resolvedAt: null,
    });
    app.expenses.failWith = null;
    await expect(app.confirm.execute(scope, id)).resolves.toMatchObject({ status: 'confirmed' });
  });

  it('sad path: a date in the future is refused by the recorder and stays pending', async () => {
    const app = setup('2026-10-05T15:00:00.000Z');
    await createFor(app, ANA);
    const id = await firstOccurrenceId(app);

    await expect(
      app.confirm.execute(await writeScopeFor(ANA), id, { date: '2026-10-20' }),
    ).rejects.toMatchObject({ code: 'MOVEMENT_DATE_IN_FUTURE' });

    expect(app.occurrences.rows[0]?.occurrence.status).toBe('pending');
  });
});

describe('SkipOccurrence (AC-09) and overdue (AC-10)', () => {
  it('marks skipped, records nothing and the date is not materialized again', async () => {
    const app = setup('2026-10-05T15:00:00.000Z');
    await createFor(app, ANA);
    const id = await firstOccurrenceId(app);
    const scope = await writeScopeFor(ANA);

    const result = await app.skip.execute(scope, id);
    const items = await app.upcoming.execute(scope);

    expect(result).toMatchObject({ status: 'skipped', movementId: null, confirmedAmount: null });
    expect(app.expenses.expenses).toHaveLength(0);
    expect(items.filter((item) => item.occurrenceId !== null)).toEqual([]);
    expect(app.occurrences.rows).toHaveLength(1);
  });

  it('returns a pending occurrence before today as overdue, across days, until resolved', async () => {
    const app = setup('2026-10-05T15:00:00.000Z');
    await createFor(app, ANA);
    const scope = await readScopeFor(ANA);
    expect((await app.upcoming.execute(scope))[0]?.kind).toBe('pending');

    app.clock.current = new Date('2026-10-06T15:00:00.000Z');
    expect((await app.upcoming.execute(scope))[0]).toMatchObject({
      kind: 'overdue',
      dueDate: '2026-10-05',
    });
    app.clock.current = new Date('2026-11-05T15:00:00.000Z');
    const later = (await app.upcoming.execute(scope)).filter((item) => item.occurrenceId);

    expect(later.map((item) => [item.kind, item.dueDate])).toEqual([
      ['overdue', '2026-10-05'],
      ['pending', '2026-11-05'],
    ]);
  });
});

describe('UpdateRecurringPayment (AC-12)', () => {
  it('uses the new amount on the next confirm and keeps the recorded expense as it was', async () => {
    const app = setup('2026-11-06T15:00:00.000Z');
    const payment = await createFor(app, ANA);
    const scope = await writeScopeFor(ANA);
    const [first, second] = (await app.upcoming.execute(scope)).map((item) => item.occurrenceId);
    if (!first || !second) throw new Error('Expected two occurrences');
    await app.confirm.execute(scope, first);

    await app.update.execute(scope, payment.id, { amount: 4825000n });
    await app.confirm.execute(scope, second);

    expect(app.expenses.expenses.map((expense) => expense.amount)).toEqual([35000000n, 4825000n]);
  });

  it('a schedule edit deletes pending occurrences and keeps resolved ones', async () => {
    const app = setup('2026-11-06T15:00:00.000Z');
    const payment = await createFor(app, ANA);
    const scope = await writeScopeFor(ANA);
    const [first] = (await app.upcoming.execute(scope)).map((item) => item.occurrenceId);
    if (!first) throw new Error('Expected an occurrence');
    await app.confirm.execute(scope, first);

    const updated = await app.update.execute(scope, payment.id, { dayOfMonth: 20 });

    expect(updated.dayOfMonth).toBe(20);
    expect(
      app.occurrences.rows.map((row) => [row.occurrence.dueDate, row.occurrence.status]),
    ).toEqual([['2026-10-05', 'confirmed']]);
  });

  it('an edit that is not a schedule change keeps pending occurrences', async () => {
    const app = setup('2026-10-05T15:00:00.000Z');
    const payment = await createFor(app, ANA);
    await app.materialize.execute(await readScopeFor(ANA));

    const updated = await app.update.execute(await writeScopeFor(ANA), payment.id, {
      name: 'Home rent',
      amount: 1n,
      dayOfMonth: 5,
    });

    expect(updated).toMatchObject({ name: 'Home rent', amount: 1n });
    expect(app.occurrences.rows).toHaveLength(1);
  });

  it('switching frequency clears the fields of the old one', async () => {
    const app = setup();
    const payment = await createFor(app, ANA);

    const updated = await app.update.execute(await writeScopeFor(ANA), payment.id, {
      frequency: 'weekly',
      weekday: 2,
    });

    expect(updated).toMatchObject({ frequency: 'weekly', weekday: 2, dayOfMonth: null });
  });

  it('sad path: a change that leaves the rule incomplete is rejected and stores nothing', async () => {
    const app = setup('2026-10-05T15:00:00.000Z');
    const payment = await createFor(app, ANA);
    await app.materialize.execute(await readScopeFor(ANA));
    const scope = await writeScopeFor(ANA);

    await expect(
      app.update.execute(scope, payment.id, { frequency: 'weekly' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', fields: ['body.weekday'] });
    await expect(
      app.update.execute(scope, payment.id, { endDate: '2026-01-01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', fields: ['body.endDate'] });

    expect(app.payments.rows[0]?.payment.frequency).toBe('monthly');
    expect(app.occurrences.rows).toHaveLength(1);
  });
});

describe('Pause, resume and delete (AC-13, AC-14, AC-15)', () => {
  it('a paused payment materializes nothing and is not projected', async () => {
    const app = setup('2026-10-05T15:00:00.000Z');
    const payment = await createFor(app, ANA);
    const scope = await writeScopeFor(ANA);

    const paused = await app.pause.execute(scope, payment.id);
    const items = await app.upcoming.execute(scope);

    expect(paused.status).toBe('paused');
    expect(items).toEqual([]);
    expect(app.occurrences.rows).toHaveLength(0);
  });

  it('resume moves the cursor to today in the zone: missed dates are never created', async () => {
    const app = setup('2026-10-01T15:00:00.000Z');
    const payment = await createFor(app, ANA, { startDate: '2026-09-05' });
    const scope = await writeScopeFor(ANA);
    await app.pause.execute(scope, payment.id);
    app.clock.current = new Date('2026-10-09T15:00:00.000Z');

    const resumed = await app.resume.execute(scope, payment.id);
    const items = await app.upcoming.execute(scope);

    expect(resumed).toMatchObject({
      status: 'active',
      scheduleFrom: '2026-10-09',
      autoRecordingFrom: '2026-10-09',
    });
    expect(items.map((item) => [item.kind, item.dueDate])).toEqual([['scheduled', '2026-11-05']]);
    expect(app.occurrences.rows).toHaveLength(0);
  });

  it('pause keeps the auto-recording start day it had', async () => {
    const app = setup('2026-10-09T15:00:00.000Z');
    const payment = await createFor(app, ANA, { mode: 'automatic' });

    app.clock.current = new Date('2026-10-20T15:00:00.000Z');
    const paused = await app.pause.execute(await writeScopeFor(ANA), payment.id);

    expect(paused).toMatchObject({ status: 'paused', autoRecordingFrom: '2026-10-09' });
  });

  it('resume computes today in the user zone', async () => {
    const app = setup('2026-10-31T16:30:00.000Z');
    app.timeZones.zone = 'Asia/Tokyo';
    const payment = await createFor(app, ANA);
    const scope = await writeScopeFor(ANA);
    await app.pause.execute(scope, payment.id);

    const resumed = await app.resume.execute(scope, payment.id);

    expect(resumed.scheduleFrom).toBe('2026-11-01');
  });

  it('delete removes the payment and its occurrences; recorded movements remain', async () => {
    const app = setup('2026-11-06T15:00:00.000Z');
    const payment = await createFor(app, ANA);
    const scope = await writeScopeFor(ANA);
    const [first] = (await app.upcoming.execute(scope)).map((item) => item.occurrenceId);
    if (!first) throw new Error('Expected an occurrence');
    await app.confirm.execute(scope, first);

    await app.remove.execute(scope, payment.id);

    expect(await app.upcoming.execute(scope)).toEqual([]);
    expect(app.occurrences.rows).toHaveLength(0);
    expect(app.expenses.expenses).toHaveLength(1);
  });
});

describe('ListRecurringPayments and GetRecurringPayment', () => {
  it('returns the next due date, and null when paused or ended', async () => {
    const app = setup();
    const active = await createFor(app, ANA);
    const paused = await createFor(app, ANA, { name: 'Paused' });
    const ended = await createFor(app, ANA, { name: 'Ended', endDate: '2026-10-05' });
    const scope = await writeScopeFor(ANA);
    await app.pause.execute(scope, paused.id);

    const views = await app.list.execute(scope);

    expect(views.map((view) => [view.payment.name, view.nextDueDate])).toEqual([
      ['Rent', '2026-11-05'],
      ['Paused', null],
      ['Ended', null],
    ]);
    expect(await app.get.execute(scope, active.id)).toMatchObject({ nextDueDate: '2026-11-05' });
    expect(ended.endDate).toBe('2026-10-05');
  });

  it('a payment whose cursor is in the future is next due from the cursor', async () => {
    const app = setup();
    await createFor(app, ANA, { startDate: '2027-02-05' });

    const [view] = await app.list.execute(await readScopeFor(ANA));

    expect(view?.nextDueDate).toBe('2027-02-05');
  });
});

describe('Other users (AC-17, AC-18)', () => {
  it('sad path: every use case on another user payment or occurrence raises ResourceNotFound', async () => {
    const app = setup('2026-10-05T15:00:00.000Z');
    const payment = await createFor(app, ANA);
    const occurrenceId = await firstOccurrenceId(app);
    const bea = await writeScopeFor(BEA);

    const attempts = [
      () => app.get.execute(bea, payment.id),
      () => app.update.execute(bea, payment.id, { name: 'Mine now' }),
      () => app.pause.execute(bea, payment.id),
      () => app.resume.execute(bea, payment.id),
      () => app.remove.execute(bea, payment.id),
      () => app.confirm.execute(bea, occurrenceId),
      () => app.skip.execute(bea, occurrenceId),
      () => app.confirm.execute(bea, MISSING_ID),
    ];

    for (const attempt of attempts) {
      await expect(attempt()).rejects.toBeInstanceOf(ResourceNotFound);
    }
    expect(app.payments.rows[0]?.payment).toMatchObject({ name: 'Rent', status: 'active' });
    expect(app.occurrences.rows[0]?.occurrence.status).toBe('pending');
    expect(app.expenses.expenses).toHaveLength(0);
  });

  it('ListUpcoming and ListRecurringPayments return only the caller items', async () => {
    const app = setup('2026-10-05T15:00:00.000Z');
    await createFor(app, ANA);
    await createFor(app, BEA, { name: 'Bea rent' });

    const ana = await app.upcoming.execute(await readScopeFor(ANA));
    const bea = await app.upcoming.execute(await readScopeFor(BEA));

    expect(ana.map((item) => item.name)).toEqual(['Rent']);
    expect(bea.map((item) => item.name)).toEqual(['Bea rent']);
    expect((await app.list.execute(await readScopeFor(BEA))).map((v) => v.payment.name)).toEqual([
      'Bea rent',
    ]);
  });
});
