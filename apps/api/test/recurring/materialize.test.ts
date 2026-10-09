import { AppError } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfirmOccurrence } from '../../src/recurring/application/confirm-occurrence';
import { ListUpcoming } from '../../src/recurring/application/list-upcoming';
import { MaterializeOccurrences } from '../../src/recurring/application/materialize-occurrences';
import { SkipOccurrence } from '../../src/recurring/application/skip-occurrence';
import { OccurrenceNotPending } from '../../src/recurring/domain/errors';
import { DrizzleOccurrenceRepository } from '../../src/recurring/infrastructure/db/drizzle-occurrence-repository';
import { DrizzleRecurringPaymentRepository } from '../../src/recurring/infrastructure/db/drizzle-recurring-payment-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { readScope, writeScope } from '../movements/db-fixtures';
import { FakeClock, FakeExpenseRecorder, FakeTimeZones } from './fakes';
import { newRecurringOwner, rentOf } from './fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

function setup(now = '2026-10-05T15:00:00.000Z') {
  const clock = new FakeClock(new Date(now));
  const deps = {
    payments: new DrizzleRecurringPaymentRepository(connection.db),
    occurrences: new DrizzleOccurrenceRepository(connection.db),
    timeZones: new FakeTimeZones(),
    clock,
    expenses: new FakeExpenseRecorder(clock),
  };
  return {
    ...deps,
    materialize: new MaterializeOccurrences(deps),
    upcoming: new ListUpcoming(deps),
    confirm: new ConfirmOccurrence(deps),
    skip: new SkipOccurrence(deps),
  };
}

const rowsOf = async (paymentId: string) =>
  (
    await connection.pool.query<{ due_date: string; status: string; movement_id: string | null }>(
      "select to_char(due_date, 'YYYY-MM-DD') as due_date, status, movement_id from recurring_occurrences where payment_id = $1 order by due_date",
      [paymentId],
    )
  ).rows;

async function rentOnDueDate(app: ReturnType<typeof setup>) {
  const owner = await newRecurringOwner(connection.db, connection.pool);
  const payment = await app.payments.create(await writeScope(owner.ownerId), rentOf(owner));
  return { owner, payment };
}

describe('MaterializeOccurrences against PostgreSQL (NFR-03, AC-06)', () => {
  it('two concurrent materializations hold one row', async () => {
    const app = setup();
    const { owner, payment } = await rentOnDueDate(app);
    const scope = await readScope(owner.ownerId);

    await Promise.all(Array.from({ length: 6 }, () => app.materialize.execute(scope)));

    expect(await rowsOf(payment.id)).toEqual([
      { due_date: '2026-10-05', status: 'pending', movement_id: null },
    ]);
  });

  it('concurrent ListUpcoming calls hold one pending occurrence and no expense', async () => {
    const app = setup();
    const { owner, payment } = await rentOnDueDate(app);
    const scope = await readScope(owner.ownerId);

    const results = await Promise.all([app.upcoming.execute(scope), app.upcoming.execute(scope)]);

    expect(results.every((items) => items.length === 1 && items[0]?.kind === 'pending')).toBe(true);
    expect(await rowsOf(payment.id)).toHaveLength(1);
    expect(app.expenses.expenses).toHaveLength(0);
  });

  it('a skipped date is not materialized again', async () => {
    const app = setup();
    const { owner, payment } = await rentOnDueDate(app);
    const [item] = await app.upcoming.execute(await readScope(owner.ownerId));
    if (!item?.occurrenceId) throw new Error('No occurrence');

    await app.skip.execute(await writeScope(owner.ownerId), item.occurrenceId);
    await app.materialize.execute(await readScope(owner.ownerId));

    expect(await rowsOf(payment.id)).toEqual([
      { due_date: '2026-10-05', status: 'skipped', movement_id: null },
    ]);
  });
});

describe('ConfirmOccurrence against PostgreSQL (AC-07, AC-08)', () => {
  it('stores the amount and the movement id', async () => {
    const app = setup();
    const { owner, payment } = await rentOnDueDate(app);
    const [item] = await app.upcoming.execute(await readScope(owner.ownerId));
    if (!item?.occurrenceId) throw new Error('No occurrence');

    const result = await app.confirm.execute(await writeScope(owner.ownerId), item.occurrenceId, {
      amount: 4825000n,
    });

    expect(result).toMatchObject({ status: 'confirmed', confirmedAmount: 4825000n });
    expect(await rowsOf(payment.id)).toEqual([
      { due_date: '2026-10-05', status: 'confirmed', movement_id: app.expenses.expenses[0]?.id },
    ]);
  });

  it('sad path: a recorder failure rolls back and leaves the occurrence pending', async () => {
    const app = setup();
    const { owner, payment } = await rentOnDueDate(app);
    const [item] = await app.upcoming.execute(await readScope(owner.ownerId));
    if (!item?.occurrenceId) throw new Error('No occurrence');
    app.expenses.failWith = new AppError('ACCOUNT_ARCHIVED');

    await expect(
      app.confirm.execute(await writeScope(owner.ownerId), item.occurrenceId),
    ).rejects.toMatchObject({ code: 'ACCOUNT_ARCHIVED' });

    expect(await rowsOf(payment.id)).toEqual([
      { due_date: '2026-10-05', status: 'pending', movement_id: null },
    ]);
  });

  it('sad path: two concurrent confirms record one expense and the other gets OccurrenceNotPending', async () => {
    const app = setup();
    const { owner } = await rentOnDueDate(app);
    const [item] = await app.upcoming.execute(await readScope(owner.ownerId));
    if (!item?.occurrenceId) throw new Error('No occurrence');
    const scope = await writeScope(owner.ownerId);

    const results = await Promise.allSettled([
      app.confirm.execute(scope, item.occurrenceId),
      app.confirm.execute(scope, item.occurrenceId),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(OccurrenceNotPending);
    expect(app.expenses.expenses).toHaveLength(1);
  });
});
