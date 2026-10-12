import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NetWorthSources } from '../../src/reports/application/ports/net-worth-sources';
import { DrizzleAccountFlowReader } from '../../src/reports/infrastructure/db/drizzle-account-flow-reader';
import { DrizzleGroupFlowReader } from '../../src/reports/infrastructure/db/drizzle-group-flow-reader';
import { DrizzleInstallmentDebtReader } from '../../src/reports/infrastructure/db/drizzle-installment-debt-reader';
import { DrizzleInvestmentReader } from '../../src/reports/infrastructure/db/drizzle-investment-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newCategory, newUserId, readScope } from '../movements/db-fixtures';
import {
  accountWith,
  expenseOf,
  flowMovement,
  groupOf,
  installmentPurchaseOf,
  memberOf,
  portfolioOf,
  settlementOf,
  snapshotOf,
  transferAt,
  windowFor,
} from './net-worth-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

function sources(db = connection.db): NetWorthSources {
  const accounts = new DrizzleAccountFlowReader(db);
  const groups = new DrizzleGroupFlowReader(db);
  const investments = new DrizzleInvestmentReader(db);
  const debt = new DrizzleInstallmentDebtReader(db);
  return {
    accountFlows: (scope, window) => accounts.accountFlows(scope, window),
    groupFlows: (scope, window) => groups.groupFlows(scope, window),
    investmentValues: (scope, points) => investments.investmentValues(scope, points),
    installmentDebtRows: (scope, window) => debt.installmentDebtRows(scope, window),
  };
}

const TODAY = '2026-08-12';

/** The account part at the end of `month`: opening, baseline and every bucket up to it. */
function accumulated(
  flows: {
    opening: Record<'ARS' | 'USD', bigint>;
    baseline: Record<'ARS' | 'USD', bigint>;
    byMonth: ReadonlyMap<string, Record<'ARS' | 'USD', bigint>>;
  },
  month: string,
  currency: 'ARS' | 'USD' = 'ARS',
): bigint {
  let total = flows.opening[currency] + flows.baseline[currency];
  for (const [bucket, amounts] of flows.byMonth) {
    if (bucket <= month) total += amounts[currency];
  }
  return total;
}

describe('accountFlows', () => {
  it('accumulates an opening balance, an April expense and a July income', async () => {
    const owner = await newUserId(connection.db);
    const account = await accountWith(connection.pool, { ownerId: owner, opening: 10000000n });
    const expense = await newCategory(connection.pool, owner, 'expense');
    const income = await newCategory(connection.pool, owner, 'income');
    await flowMovement(connection.pool, {
      ownerId: owner,
      accountId: account,
      categoryId: expense,
      type: 'expense',
      amount: 3000000n,
      occurredAt: '2026-04-10T15:00:00Z',
    });
    await flowMovement(connection.pool, {
      ownerId: owner,
      accountId: account,
      categoryId: income,
      type: 'income',
      amount: 1000000n,
      occurredAt: '2026-07-10T15:00:00Z',
    });

    const flows = await sources().accountFlows(
      await readScope(owner),
      windowFor('2026-04', '2026-07', TODAY),
    );

    expect(accumulated(flows, '2026-04')).toBe(7000000n);
    expect(accumulated(flows, '2026-07')).toBe(8000000n);
  });

  it('puts what happened before the range in the baseline', async () => {
    const owner = await newUserId(connection.db);
    const account = await accountWith(connection.pool, { ownerId: owner, opening: 500n });
    const expense = await newCategory(connection.pool, owner, 'expense');
    await flowMovement(connection.pool, {
      ownerId: owner,
      accountId: account,
      categoryId: expense,
      type: 'expense',
      amount: 200n,
      occurredAt: '2026-01-10T15:00:00Z',
    });

    const flows = await sources().accountFlows(
      await readScope(owner),
      windowFor('2026-04', '2026-07', TODAY),
    );

    expect(flows.opening).toEqual({ ARS: 500n, USD: 0n });
    expect(flows.baseline).toEqual({ ARS: -200n, USD: 0n });
    expect(flows.byMonth.size).toBe(0);
  });

  it('leaves the total unchanged by a transfer between two ARS accounts and moves value in an exchange', async () => {
    const owner = await newUserId(connection.db);
    const first = await accountWith(connection.pool, { ownerId: owner, opening: 10000000n });
    const second = await accountWith(connection.pool, { ownerId: owner });
    const usd = await accountWith(connection.pool, { ownerId: owner, currency: 'USD' });
    await transferAt(connection.pool, {
      ownerId: owner,
      accountId: first,
      destinationAccountId: second,
      amount: 500000n,
      occurredAt: '2026-06-10T15:00:00Z',
    });
    await transferAt(connection.pool, {
      ownerId: owner,
      accountId: first,
      destinationAccountId: usd,
      amount: 1400000n,
      destinationAmount: 1000n,
      exchangeRate: 14000000n,
      occurredAt: '2026-06-12T15:00:00Z',
    });

    const flows = await sources().accountFlows(
      await readScope(owner),
      windowFor('2026-05', '2026-07', TODAY),
    );

    expect(accumulated(flows, '2026-05')).toBe(10000000n);
    // Only the exchange changes the ARS total; the transfer nets to 0.
    expect(accumulated(flows, '2026-06')).toBe(10000000n - 1400000n);
    expect(accumulated(flows, '2026-06', 'USD')).toBe(1000n);
  });

  it('buckets a movement at 01:00 UTC on 1 July in June for Buenos Aires', async () => {
    const owner = await newUserId(connection.db);
    const account = await accountWith(connection.pool, { ownerId: owner });
    const income = await newCategory(connection.pool, owner, 'income');
    await flowMovement(connection.pool, {
      ownerId: owner,
      accountId: account,
      categoryId: income,
      type: 'income',
      amount: 900n,
      occurredAt: '2026-07-01T01:00:00Z',
    });

    const flows = await sources().accountFlows(
      await readScope(owner),
      windowFor('2026-06', '2026-07', TODAY),
    );

    expect(flows.byMonth.get('2026-06')).toEqual({ ARS: 900n, USD: 0n });
    expect(flows.byMonth.get('2026-07')).toBeUndefined();
  });

  it('ignores what happens after the end of the last point day', async () => {
    const owner = await newUserId(connection.db);
    const account = await accountWith(connection.pool, { ownerId: owner });
    const income = await newCategory(connection.pool, owner, 'income');
    await flowMovement(connection.pool, {
      ownerId: owner,
      accountId: account,
      categoryId: income,
      type: 'income',
      amount: 900n,
      occurredAt: '2026-08-13T03:00:00Z',
    });

    const flows = await sources().accountFlows(
      await readScope(owner),
      windowFor('2026-07', '2026-08', TODAY),
    );

    expect(flows.byMonth.size).toBe(0);
  });

  it('excludes an archived account with its movements, settlements and opening balance', async () => {
    const owner = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const archived = await accountWith(connection.pool, {
      ownerId: owner,
      opening: 777n,
      archived: true,
    });
    const income = await newCategory(connection.pool, owner, 'income');
    await flowMovement(connection.pool, {
      ownerId: owner,
      accountId: archived,
      categoryId: income,
      type: 'income',
      amount: 900n,
      occurredAt: '2026-06-10T15:00:00Z',
    });
    const group = await groupOf(connection.pool);
    const mine = await memberOf(connection.pool, group, owner);
    const theirs = await memberOf(connection.pool, group, other);
    await settlementOf(connection.pool, {
      groupId: group,
      fromMemberId: theirs,
      toMemberId: mine,
      amount: 300n,
      occurredAt: '2026-06-11T15:00:00Z',
      account: { id: archived, memberId: mine },
    });

    const flows = await sources().accountFlows(
      await readScope(owner),
      windowFor('2026-05', '2026-07', TODAY),
    );

    expect(flows.opening).toEqual({ ARS: 0n, USD: 0n });
    expect(flows.baseline).toEqual({ ARS: 0n, USD: 0n });
    expect(flows.byMonth.size).toBe(0);
  });

  it('counts a settlement payment: positive for the receiving member, negative for the paying one', async () => {
    const owner = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const account = await accountWith(connection.pool, { ownerId: owner });
    const group = await groupOf(connection.pool);
    const mine = await memberOf(connection.pool, group, owner);
    const theirs = await memberOf(connection.pool, group, other);
    await settlementOf(connection.pool, {
      groupId: group,
      fromMemberId: theirs,
      toMemberId: mine,
      amount: 300n,
      occurredAt: '2026-06-11T15:00:00Z',
      account: { id: account, memberId: mine },
    });
    await settlementOf(connection.pool, {
      groupId: group,
      fromMemberId: mine,
      toMemberId: theirs,
      amount: 50n,
      occurredAt: '2026-06-12T15:00:00Z',
      account: { id: account, memberId: mine },
    });

    const flows = await sources().accountFlows(
      await readScope(owner),
      windowFor('2026-05', '2026-07', TODAY),
    );

    expect(flows.byMonth.get('2026-06')).toEqual({ ARS: 250n, USD: 0n });
  });

  it('never reads the rows of another user', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const hers = await accountWith(connection.pool, { ownerId: bea, opening: 999n });
    const income = await newCategory(connection.pool, bea, 'income');
    await flowMovement(connection.pool, {
      ownerId: bea,
      accountId: hers,
      categoryId: income,
      type: 'income',
      amount: 1n,
      occurredAt: '2026-06-10T15:00:00Z',
    });

    const flows = await sources().accountFlows(
      await readScope(ana),
      windowFor('2026-05', '2026-07', TODAY),
    );

    expect(flows.opening).toEqual({ ARS: 0n, USD: 0n });
    expect(flows.baseline).toEqual({ ARS: 0n, USD: 0n });
    expect(flows.byMonth.size).toBe(0);
  });
});

describe('investmentValues', () => {
  it('uses the latest snapshot on or before the point date', async () => {
    const owner = await newUserId(connection.db);
    const portfolio = await portfolioOf(connection.pool, owner, '2026-01-01T00:00:00Z');
    await snapshotOf(connection.pool, {
      portfolioId: portfolio,
      ownerId: owner,
      date: '2026-06-29',
      value: 1500n,
    });
    await snapshotOf(connection.pool, {
      portfolioId: portfolio,
      ownerId: owner,
      date: '2026-07-02',
      value: 9000n,
    });
    const window = windowFor('2026-06', '2026-07', TODAY);

    const result = await sources().investmentValues(await readScope(owner), window.points);

    expect(result.values.get('2026-06-30')).toEqual({ ARS: 1500n, USD: 0n });
    expect(result.values.get('2026-07-31')).toEqual({ ARS: 9000n, USD: 0n });
    expect(result.incompleteDates.size).toBe(0);
  });

  it('counts 0 and marks the point incomplete for a portfolio created before it with no snapshot', async () => {
    const owner = await newUserId(connection.db);
    await portfolioOf(connection.pool, owner, '2026-05-01T12:00:00Z');
    const window = windowFor('2026-06', '2026-07', TODAY);

    const result = await sources().investmentValues(await readScope(owner), window.points);

    expect(result.values.get('2026-06-30') ?? { ARS: 0n, USD: 0n }).toEqual({ ARS: 0n, USD: 0n });
    expect([...result.incompleteDates].sort()).toEqual(['2026-06-30', '2026-07-31']);
  });

  it('counts 0 and does not mark a portfolio created after the point', async () => {
    const owner = await newUserId(connection.db);
    await portfolioOf(connection.pool, owner, '2026-07-15T12:00:00Z');
    const window = windowFor('2026-06', '2026-07', TODAY);

    const result = await sources().investmentValues(await readScope(owner), window.points);

    expect([...result.incompleteDates]).toEqual(['2026-07-31']);
  });

  it('sums portfolios per currency and never reads another user', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const first = await portfolioOf(connection.pool, ana, '2026-01-01T00:00:00Z');
    const second = await portfolioOf(connection.pool, ana, '2026-01-01T00:00:00Z');
    const hers = await portfolioOf(connection.pool, bea, '2026-01-01T00:00:00Z');
    await snapshotOf(connection.pool, {
      portfolioId: first,
      ownerId: ana,
      date: '2026-06-20',
      value: 100n,
    });
    await snapshotOf(connection.pool, {
      portfolioId: second,
      ownerId: ana,
      date: '2026-06-20',
      value: 50n,
    });
    await snapshotOf(connection.pool, {
      portfolioId: second,
      ownerId: ana,
      date: '2026-06-20',
      value: 7n,
      currency: 'USD',
    });
    await snapshotOf(connection.pool, {
      portfolioId: hers,
      ownerId: bea,
      date: '2026-06-20',
      value: 99999n,
    });
    const window = windowFor('2026-06', '2026-06', TODAY);

    const result = await sources().investmentValues(await readScope(ana), window.points);

    expect(result.values.get('2026-06-30')).toEqual({ ARS: 150n, USD: 7n });
  });
});

describe('groupFlows', () => {
  it('adds what members owe the user and subtracts what the user owes, former groups included', async () => {
    const owner = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const first = await groupOf(connection.pool);
    const mine = await memberOf(connection.pool, first, owner);
    const theirs = await memberOf(connection.pool, first, other);
    // The user paid 30,000.00 for the other member only.
    await expenseOf(connection.pool, {
      groupId: first,
      payerMemberId: mine,
      amount: 3000000n,
      occurredAt: '2026-06-10T15:00:00Z',
      shares: [{ memberId: theirs, amount: 3000000n }],
    });
    // In a group the user already left, they owe 20,000.00.
    const second = await groupOf(connection.pool);
    const mineThere = await memberOf(connection.pool, second, owner, true);
    const hers = await memberOf(connection.pool, second, other);
    await expenseOf(connection.pool, {
      groupId: second,
      payerMemberId: hers,
      amount: 2000000n,
      occurredAt: '2026-06-11T15:00:00Z',
      shares: [{ memberId: mineThere, amount: 2000000n }],
    });

    const flows = await sources().groupFlows(
      await readScope(owner),
      windowFor('2026-05', '2026-07', TODAY),
    );

    expect(flows.byMonth.get('2026-06')).toEqual({ ARS: 1000000n, USD: 0n });
    expect(flows.baseline).toEqual({ ARS: 0n, USD: 0n });
  });

  it('puts a settlement dated after the month end in no bucket of that point', async () => {
    const owner = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const group = await groupOf(connection.pool);
    const mine = await memberOf(connection.pool, group, owner);
    const theirs = await memberOf(connection.pool, group, other);
    await expenseOf(connection.pool, {
      groupId: group,
      payerMemberId: mine,
      amount: 1000n,
      occurredAt: '2026-06-10T15:00:00Z',
      shares: [{ memberId: theirs, amount: 1000n }],
    });
    // The other member pays the debt back in July.
    await settlementOf(connection.pool, {
      groupId: group,
      fromMemberId: theirs,
      toMemberId: mine,
      amount: 1000n,
      occurredAt: '2026-07-05T15:00:00Z',
    });

    const flows = await sources().groupFlows(
      await readScope(owner),
      windowFor('2026-05', '2026-07', TODAY),
    );

    expect(flows.byMonth.get('2026-06')).toEqual({ ARS: 1000n, USD: 0n });
    expect(flows.byMonth.get('2026-07')).toEqual({ ARS: -1000n, USD: 0n });
  });

  it('never reads the groups of another user', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const group = await groupOf(connection.pool);
    const hers = await memberOf(connection.pool, group, bea);
    const theirs = await memberOf(connection.pool, group, other);
    await expenseOf(connection.pool, {
      groupId: group,
      payerMemberId: hers,
      amount: 1000n,
      occurredAt: '2026-06-10T15:00:00Z',
      shares: [{ memberId: theirs, amount: 1000n }],
    });

    const flows = await sources().groupFlows(
      await readScope(ana),
      windowFor('2026-05', '2026-07', TODAY),
    );

    expect(flows.byMonth.size).toBe(0);
    expect(flows.baseline).toEqual({ ARS: 0n, USD: 0n });
  });
});

describe('installmentDebtRows', () => {
  it('reads the rows of a purchase with stored and derived closing dates', async () => {
    const owner = await newUserId(connection.db);
    const category = await newCategory(connection.pool, owner, 'expense');
    await installmentPurchaseOf(connection.pool, {
      ownerId: owner,
      categoryId: category,
      purchasedOn: '2026-04-15',
      firstPeriod: '2026-05',
      count: 6,
      each: 1000000n,
      statements: [
        { period: '2026-06', closingDate: '2026-06-20', dueDate: '2026-07-05' },
        { period: '2026-07', closingDate: '2026-07-20', dueDate: '2026-08-05' },
      ],
    });
    const window = windowFor('2026-06', '2026-07', TODAY);

    const rows = await sources().installmentDebtRows(await readScope(owner), window);

    const byPeriod = new Map(rows.map((row) => [row.period, row]));
    expect(byPeriod.get('2026-06')).toMatchObject({
      closingDate: '2026-06-20',
      purchaseMonth: '2026-04',
      currency: 'ARS',
      sum: 1000000n,
    });
    expect(byPeriod.get('2026-08')).toMatchObject({ closingDate: null, closingDay: 20, dueDay: 5 });
    // Periods before the month ahead of the first point are not read.
    expect(byPeriod.has('2026-05')).toBe(true);
    expect(byPeriod.has('2026-04')).toBe(false);
  });

  it('leaves out a purchase made after the last point and never reads another user', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const mine = await newCategory(connection.pool, ana, 'expense');
    const hers = await newCategory(connection.pool, bea, 'expense');
    await installmentPurchaseOf(connection.pool, {
      ownerId: ana,
      categoryId: mine,
      purchasedOn: '2026-09-01',
      firstPeriod: '2026-09',
      count: 2,
      each: 100n,
    });
    await installmentPurchaseOf(connection.pool, {
      ownerId: bea,
      categoryId: hers,
      purchasedOn: '2026-04-01',
      firstPeriod: '2026-06',
      count: 2,
      each: 100n,
    });

    const rows = await sources().installmentDebtRows(
      await readScope(ana),
      windowFor('2026-06', '2026-07', TODAY),
    );

    expect(rows).toEqual([]);
  });
});

describe('failures', () => {
  it('rejects the whole read when the database fails, with no partial result', async () => {
    const owner = await newUserId(connection.db);
    const scope = await readScope(owner);
    const closed = createDatabase(testDatabaseUrl);
    await closed.pool.end();
    const failing = sources(closed.db);
    const window = windowFor('2026-06', '2026-07', TODAY);

    await expect(failing.accountFlows(scope, window)).rejects.toThrow();
    await expect(failing.groupFlows(scope, window)).rejects.toThrow();
    await expect(failing.investmentValues(scope, window.points)).rejects.toThrow();
    await expect(failing.installmentDebtRows(scope, window)).rejects.toThrow();
  });
});
