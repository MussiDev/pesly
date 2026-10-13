import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMonthFlows } from '../../src/dashboard/application/build-month-flows';
import { prepareDashboard } from '../../src/dashboard/application/dashboard-context';
import { DrizzleFlowReader } from '../../src/reports';
import { GetExpensesByCategory } from '../../src/reports/application/get-expenses-by-category';
import { DrizzleReportFilterReader } from '../../src/reports/infrastructure/db/drizzle-report-filter-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newTransfer, newUserId, readScope } from '../movements/db-fixtures';
import { newCard, newMovementAt, newNamedCategory, newStatement } from '../reports/flow-fixtures';
import { FakePreferences, FixedClock } from './fakes';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
const OCTOBER_15 = new Date('2026-10-15T16:00:00.000Z');
const SEPTEMBER_28 = new Date('2026-09-28T16:00:00.000Z');

let connection: DatabaseConnection;
let reader: DrizzleFlowReader;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  reader = new DrizzleFlowReader(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

/** A card closing on the 24th and due on the 5th, with the September statement stored. */
async function world() {
  const ana = await newUserId(connection.db, { timeZone: BUENOS_AIRES });
  const cardArs = await newAccount(connection.pool, ana, false, 'ARS');
  const cardUsd = await newAccount(connection.pool, ana, false, 'USD');
  const bank = await newAccount(connection.pool, ana, false, 'ARS');
  const food = await newNamedCategory(connection.pool, ana, { name: 'Food' });
  const cardId = await newCard(connection.pool, {
    ownerId: ana,
    arsAccountId: cardArs,
    usdAccountId: cardUsd,
    closingDay: 24,
    dueDay: 5,
  });
  await newStatement(connection.pool, {
    cardId,
    ownerId: ana,
    period: '2026-09',
    closingDate: '2026-09-24',
    dueDate: '2026-10-05',
  });
  return { ana, cardId, scope: await readScope(ana), cardArs, cardUsd, bank, food };
}

type World = Awaited<ReturnType<typeof world>>;

const spend = (
  w: World,
  amount: bigint,
  occurredAt: string,
  accountId = w.cardArs,
  rate?: bigint,
) =>
  newMovementAt(connection.pool, {
    ownerId: w.ana,
    accountId,
    categoryId: w.food,
    amount,
    occurredAt,
    ...(rate === undefined ? {} : { rate }),
  });

async function monthOf(w: World, now: Date) {
  const context = await prepareDashboard(
    { clock: new FixedClock(now), preferences: new FakePreferences() },
    w.scope,
  );
  return (await buildMonthFlows({ flows: reader }, w.scope, context)).month;
}

describe('card purchases on the dashboard month flows', () => {
  it('counts the 2026-09-20 purchase in October and not in September (AC-06)', async () => {
    const w = await world();
    await spend(w, 3000000n, '2026-09-20T15:00:00Z');

    const october = await monthOf(w, OCTOBER_15);
    const september = await monthOf(w, SEPTEMBER_28);

    expect(october.expenses).toBe(3000000n);
    expect(september.expenses).toBe(0n);
  });

  it('keeps a bank account expense of the same day in September (AC-07)', async () => {
    const w = await world();
    await spend(w, 800000n, '2026-09-20T15:00:00Z', w.bank);

    expect((await monthOf(w, SEPTEMBER_28)).expenses).toBe(800000n);
    expect((await monthOf(w, OCTOBER_15)).expenses).toBe(0n);
  });

  it('gives the same October spending as the expenses by category report on the same data (AC-06, AC-01)', async () => {
    const w = await world();
    await spend(w, 3000000n, '2026-09-20T15:00:00Z');
    const report = await new GetExpensesByCategory({
      clock: new FixedClock(OCTOBER_15),
      preferences: new FakePreferences(),
      filters: new DrizzleReportFilterReader(connection.db),
      flows: reader,
    }).execute(w.scope, { from: '2026-10-01', to: '2026-10-15' });

    const dashboard = await monthOf(w, OCTOBER_15);

    expect(BigInt(report.total)).toBe(dashboard.expenses);
  });

  it('counts the whole current month: a purchase whose statement is due later this month counts today (AC-06)', async () => {
    const w = await world();
    await newStatement(connection.pool, {
      cardId: w.cardId,
      ownerId: w.ana,
      period: '2026-10',
      closingDate: '2026-10-24',
      dueDate: '2026-10-28',
    });
    await spend(w, 500000n, '2026-10-05T15:00:00Z');

    // Today is the 15th and the statement is due on the 28th: it is still this month's spending.
    expect((await monthOf(w, OCTOBER_15)).expenses).toBe(500000n);
  });

  it('converts a USD card purchase with its own frozen rate (AC-10)', async () => {
    const w = await world();
    await spend(w, 2000n, '2026-09-20T15:00:00Z', w.cardUsd, 12000000n);

    // 20.00 USD at a frozen 1,200.0000 is 24,000.00 ARS.
    expect((await monthOf(w, OCTOBER_15)).expenses).toBe(2400000n);
  });

  it('counts a statement payment as no spending on the dashboard (AC-09)', async () => {
    const w = await world();
    await newTransfer(connection.pool, {
      ownerId: w.ana,
      accountId: w.bank,
      destinationAccountId: w.cardArs,
      amount: 3000000n,
    });

    const month = await monthOf(w, OCTOBER_15);

    expect([month.expenses, month.income]).toEqual([0n, 0n]);
  });

  it('does not count the card purchase of another user (AC-16)', async () => {
    const mine = await world();
    const other = await world();
    await spend(other, 9999n, '2026-09-20T15:00:00Z');

    expect((await monthOf(mine, OCTOBER_15)).expenses).toBe(0n);
    expect((await monthOf(other, OCTOBER_15)).expenses).toBe(9999n);
  });
});
