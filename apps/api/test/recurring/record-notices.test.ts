import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRecurringExpenseRecorder } from '../../src/movements/infrastructure/recurring/drizzle-recurring-expense-recorder';
import { createNoticePublisher } from '../../src/notices';
import { DrizzleRecurringPaymentRepository } from '../../src/recurring/infrastructure/db/drizzle-recurring-payment-repository';
import { createRecordingJob } from '../../src/recurring/jobs';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../fakes/mutable-clock';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newUserId, writeScope } from '../movements/db-fixtures';
import { rentOf } from './fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

/** Automatic rent due on 2026-10-05 for an owner writing in English. */
async function dueRent(options: { archivedAccount?: boolean } = {}) {
  await connection.pool.query(
    `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
     values ('oficial', 13900000, 14000000, now(), now()) on conflict (rate_type) do nothing`,
  );
  const ownerId = await newUserId(connection.db, { rateType: 'oficial' });
  await connection.pool.query("update users set language = 'en' where id = $1", [ownerId]);
  const owner = {
    ownerId,
    accountId: await newAccount(connection.pool, ownerId),
    categoryId: await newCategory(connection.pool, ownerId, 'expense'),
  };
  const payment = await new DrizzleRecurringPaymentRepository(connection.db).create(
    await writeScope(ownerId),
    rentOf(owner, { mode: 'automatic' }),
  );
  if (options.archivedAccount) {
    await connection.pool.query('update accounts set archived_at = now() where id = $1', [
      owner.accountId,
    ]);
  }
  return { owner, payment };
}

function jobFor(clock: MutableClock) {
  const logger = createLogger({ level: 'silent', destination: { write: () => undefined } });
  return createRecordingJob({
    db: connection.db,
    logger,
    recorder: createRecurringExpenseRecorder(connection.db, logger, { clock }),
    notices: createNoticePublisher(connection.db),
    clock,
    intervalSeconds: 60,
  });
}

const noticesOf = async (paymentId: string) =>
  (
    await connection.pool.query<{ kind: string; text: string; due_date: string }>(
      "select kind, text, to_char(due_date, 'YYYY-MM-DD') as due_date from notices where payment_id = $1 order by kind",
      [paymentId],
    )
  ).rows;

const countMovements = async (ownerId: string): Promise<number> =>
  Number(
    (
      await connection.pool.query<{ n: string }>(
        'select count(*) as n from movements where owner_id = $1',
        [ownerId],
      )
    ).rows[0]?.n,
  );

const statusOf = async (paymentId: string): Promise<string[]> =>
  (
    await connection.pool.query<{ status: string }>(
      'select status from recurring_occurrences where payment_id = $1 order by due_date',
      [paymentId],
    )
  ).rows.map((row) => row.status);

const NOON_UTC = '2026-10-05T15:00:00.000Z';

describe('recording job notices over the database', () => {
  it('records the expense and stores one recorded notice with the name and day and no amount (AC-12)', async () => {
    const { payment } = await dueRent();

    await jobFor(new MutableClock(new Date(NOON_UTC))).runOnce();

    const rows = await noticesOf(payment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'recorded', due_date: '2026-10-05' });
    expect(rows[0]?.text).toContain('Rent');
    expect(rows[0]?.text).not.toMatch(/35000000|350000|\$/);
  });

  it('an archived account: no expense, the occurrence stays pending, one not_recorded notice after 6 passes (AC-13, AC-14)', async () => {
    const { owner, payment } = await dueRent({ archivedAccount: true });
    const job = jobFor(new MutableClock(new Date(NOON_UTC)));

    for (let pass = 0; pass < 6; pass++) await job.runOnce();

    expect(await countMovements(owner.ownerId)).toBe(0);
    expect(await statusOf(payment.id)).toEqual(['pending']);
    const rows = await noticesOf(payment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'not_recorded', due_date: '2026-10-05' });
  });

  it('three passes over the same recorded occurrence hold one recorded notice (AC-23)', async () => {
    const { owner, payment } = await dueRent();
    const job = jobFor(new MutableClock(new Date(NOON_UTC)));

    await job.runOnce();
    await job.runOnce();
    await job.runOnce();

    expect(await countMovements(owner.ownerId)).toBe(1);
    expect((await noticesOf(payment.id)).map((row) => row.kind)).toEqual(['recorded']);
  });

  it('two concurrent passes hold one recorded notice (AC-24)', async () => {
    const { payment } = await dueRent();
    const clock = new MutableClock(new Date(NOON_UTC));

    await Promise.all([jobFor(clock).runOnce(), jobFor(clock).runOnce()]);

    expect((await noticesOf(payment.id)).map((row) => row.kind)).toEqual(['recorded']);
  });

  it('two concurrent passes over an archived account hold one not_recorded notice (AC-24)', async () => {
    const { payment } = await dueRent({ archivedAccount: true });
    const clock = new MutableClock(new Date(NOON_UTC));

    await Promise.all([jobFor(clock).runOnce(), jobFor(clock).runOnce()]);

    expect((await noticesOf(payment.id)).map((row) => row.kind)).toEqual(['not_recorded']);
  });
});
