import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GetExpensesByCategory } from '../../src/reports/application/get-expenses-by-category';
import { GetIncomeExpenses } from '../../src/reports/application/get-income-expenses';
import { DrizzleFlowReader } from '../../src/reports/infrastructure/db/drizzle-flow-reader';
import { DrizzleReportFilterReader } from '../../src/reports/infrastructure/db/drizzle-report-filter-reader';
import { presentIncomeExpenses } from '../../src/reports/infrastructure/http/present-income-expenses';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  linkTag,
  newAccount,
  newTag,
  newTransfer,
  newUserId,
  readScope,
} from '../movements/db-fixtures';
import { FakePreferences, FixedClock } from './fakes';
import { newCard, newMovementAt, newNamedCategory, newStatement } from './flow-fixtures';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

let connection: DatabaseConnection;
let byCategory: GetExpensesByCategory;
let incomeExpenses: GetIncomeExpenses;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  const deps = {
    clock: new FixedClock(new Date('2026-12-15T16:00:00.000Z')),
    preferences: new FakePreferences({
      displayCurrency: 'ARS',
      defaultRateType: 'mep',
      timeZone: BUENOS_AIRES,
    }),
    filters: new DrizzleReportFilterReader(connection.db),
    flows: new DrizzleFlowReader(connection.db),
  };
  byCategory = new GetExpensesByCategory(deps);
  incomeExpenses = new GetIncomeExpenses({ ...deps, present: presentIncomeExpenses });
});

afterAll(async () => {
  await connection.pool.end();
});

/** A card closing on the 24th and due on the 5th, with the September and October statements stored. */
async function world(options: { statements?: boolean; closingDay?: number; dueDay?: number } = {}) {
  const ana = await newUserId(connection.db, { timeZone: BUENOS_AIRES });
  const cardArs = await newAccount(connection.pool, ana, false, 'ARS');
  const cardUsd = await newAccount(connection.pool, ana, false, 'USD');
  const bank = await newAccount(connection.pool, ana, false, 'ARS');
  const food = await newNamedCategory(connection.pool, ana, { name: 'Food' });
  const cardId = await newCard(connection.pool, {
    ownerId: ana,
    arsAccountId: cardArs,
    usdAccountId: cardUsd,
    closingDay: options.closingDay ?? 24,
    dueDay: options.dueDay ?? 5,
  });
  if (options.statements !== false) {
    await newStatement(connection.pool, {
      cardId,
      ownerId: ana,
      period: '2026-09',
      closingDate: '2026-09-24',
      dueDate: '2026-10-05',
    });
    await newStatement(connection.pool, {
      cardId,
      ownerId: ana,
      period: '2026-10',
      closingDate: '2026-10-24',
      dueDate: '2026-11-05',
    });
  }
  return { ana, scope: await readScope(ana), cardArs, cardUsd, bank, food, cardId };
}

type World = Awaited<ReturnType<typeof world>>;

const spend = (
  w: World,
  fields: { amount: bigint; occurredAt: string; accountId?: string; rate?: bigint },
) =>
  newMovementAt(connection.pool, {
    ownerId: w.ana,
    accountId: fields.accountId ?? w.cardArs,
    categoryId: w.food,
    amount: fields.amount,
    occurredAt: fields.occurredAt,
    ...(fields.rate === undefined ? {} : { rate: fields.rate }),
  });

const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' };
const OCTOBER = { from: '2026-10-01', to: '2026-10-31' };

const totalOf = async (w: World, range: { from: string; to: string }, extra: object = {}) =>
  (await byCategory.execute(w.scope, { ...range, ...extra })).total;

describe('card purchases in the reports, by the month their statement is due', () => {
  it('counts a September purchase in October in the expenses by category report (AC-01)', async () => {
    const w = await world();
    await spend(w, { amount: 3000000n, occurredAt: '2026-09-20T15:00:00Z' });

    const october = await byCategory.execute(w.scope, OCTOBER);

    expect(october.categories).toEqual([
      { categoryId: w.food, name: 'Food', defaultKey: null, amount: '3000000' },
    ]);
    expect(await totalOf(w, SEPTEMBER)).toBe('0');
  });

  it('counts the same purchase as October spending in the income and expenses report (AC-02)', async () => {
    const w = await world();
    await spend(w, { amount: 3000000n, occurredAt: '2026-09-20T15:00:00Z' });

    const response = await incomeExpenses.execute(w.scope, {
      from: '2026-09-01',
      to: '2026-10-31',
    });

    expect(response.months).toEqual([
      { month: '2026-09', income: '0', expenses: '0' },
      { month: '2026-10', income: '0', expenses: '3000000' },
    ]);
  });

  it('counts a purchase dated after the closing date in the month of the next statement (AC-03)', async () => {
    const w = await world();
    await spend(w, { amount: 100n, occurredAt: '2026-09-25T15:00:00Z' });

    expect(await totalOf(w, OCTOBER)).toBe('0');
    expect(await totalOf(w, { from: '2026-11-01', to: '2026-11-30' })).toBe('100');
  });

  it('follows the stored due date when it was edited by hand (AC-04)', async () => {
    const w = await world({ statements: false });
    await newStatement(connection.pool, {
      cardId: w.cardId,
      ownerId: w.ana,
      period: '2026-09',
      closingDate: '2026-09-24',
      dueDate: '2026-11-02',
    });
    await spend(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });

    expect(await totalOf(w, OCTOBER)).toBe('0');
    expect(await totalOf(w, { from: '2026-11-01', to: '2026-11-30' })).toBe('100');
  });

  it('uses the due date computed from the card days when the statement is not stored (AC-05)', async () => {
    const w = await world({ statements: false });
    await spend(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });

    expect(await totalOf(w, SEPTEMBER)).toBe('0');
    expect(await totalOf(w, OCTOBER)).toBe('100');
  });

  it('keeps an expense on a bank account in the month of its own date (AC-07)', async () => {
    const w = await world();
    await spend(w, { amount: 800000n, occurredAt: '2026-09-20T15:00:00Z', accountId: w.bank });

    expect(await totalOf(w, SEPTEMBER)).toBe('800000');
    expect(await totalOf(w, OCTOBER)).toBe('0');
    const response = await incomeExpenses.execute(w.scope, {
      from: '2026-09-01',
      to: '2026-10-31',
    });
    expect(response.months.map((month) => month.expenses)).toEqual(['800000', '0']);
  });

  it('counts the purchase exactly once across September and October (AC-08)', async () => {
    const w = await world();
    await spend(w, { amount: 3000000n, occurredAt: '2026-09-20T15:00:00Z' });

    expect(await totalOf(w, { from: '2026-09-01', to: '2026-10-31' })).toBe('3000000');
    const response = await incomeExpenses.execute(w.scope, {
      from: '2026-09-01',
      to: '2026-10-31',
    });
    const sum = response.months.reduce((total, month) => total + BigInt(month.expenses), 0n);
    expect(sum).toBe(3000000n);
  });

  it('counts a statement payment from a bank account as no spending and no income (AC-09)', async () => {
    const w = await world();
    await spend(w, { amount: 3000000n, occurredAt: '2026-09-20T15:00:00Z' });
    await newTransfer(connection.pool, {
      ownerId: w.ana,
      accountId: w.bank,
      destinationAccountId: w.cardArs,
      amount: 3000000n,
    });

    const response = await incomeExpenses.execute(w.scope, {
      from: '2026-09-01',
      to: '2026-12-15',
    });

    expect(response.months.map((month) => [month.month, month.income, month.expenses])).toEqual([
      ['2026-09', '0', '0'],
      ['2026-10', '0', '3000000'],
      ['2026-11', '0', '0'],
      ['2026-12', '0', '0'],
    ]);
  });

  it('converts a 20.00 USD card purchase with its own frozen rate (AC-10)', async () => {
    const w = await world();
    await spend(w, {
      amount: 2000n,
      occurredAt: '2026-09-20T15:00:00Z',
      accountId: w.cardUsd,
      rate: 14000000n,
    });

    // 20.00 USD at a frozen 1,400.0000 is 28,000.00 ARS, in the month the statement is due.
    expect(await totalOf(w, OCTOBER)).toBe('2800000');
  });

  it('counts the purchase in October when the report is filtered by the card account or a tag (AC-11)', async () => {
    const w = await world();
    const tagged = await spend(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });
    await spend(w, { amount: 20n, occurredAt: '2026-09-21T15:00:00Z', accountId: w.bank });
    const tag = await newTag(connection.pool, w.ana, 'viaje');
    await linkTag(connection.pool, { movementId: tagged, tagId: tag, ownerId: w.ana, position: 0 });

    expect(await totalOf(w, OCTOBER, { accountId: w.cardArs })).toBe('100');
    expect(await totalOf(w, OCTOBER, { tag: 'viaje' })).toBe('100');
    expect(await totalOf(w, SEPTEMBER, { accountId: w.cardArs })).toBe('0');
    const filtered = await incomeExpenses.execute(w.scope, {
      from: '2026-09-01',
      to: '2026-10-31',
      accountId: w.cardArs,
    });
    expect(filtered.months.map((month) => month.expenses)).toEqual(['0', '100']);
  });

  it('does not count the card purchase of another user for the caller (AC-16)', async () => {
    const mine = await world();
    const other = await world();
    await spend(other, { amount: 9999n, occurredAt: '2026-09-20T15:00:00Z' });

    expect(await totalOf(mine, OCTOBER)).toBe('0');
    expect(await totalOf(other, OCTOBER)).toBe('9999');
  });

  it('counts a purchase once and does not fail for a card whose clamped days give a short-month due date (AC-14)', async () => {
    const w = await world({ statements: false, closingDay: 31, dueDay: 31 });
    await spend(w, { amount: 100n, occurredAt: '2026-02-20T15:00:00Z' });

    const response = await incomeExpenses.execute(w.scope, {
      from: '2026-01-01',
      to: '2026-06-30',
    });

    const sum = response.months.reduce((total, month) => total + BigInt(month.expenses), 0n);
    expect(sum).toBe(100n);
  });

  it('reads a purchase stored before this change under the new rule, with no migration step (AC-12)', async () => {
    const w = await world();
    await spend(w, { amount: 3000000n, occurredAt: '2026-09-20T15:00:00Z' });

    expect(await totalOf(w, OCTOBER)).toBe('3000000');
  });
});
