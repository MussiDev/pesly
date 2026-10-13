import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ListBudgetSpending } from '../../src/budgets/application/list-budget-spending';
import { DrizzleBudgetVersionReader } from '../../src/budgets/infrastructure/db/drizzle-budget-version-reader';
import { DrizzleSpendingReader } from '../../src/budgets/infrastructure/db/drizzle-spending-reader';
import { DrizzleUserTimeZone } from '../../src/budgets/infrastructure/db/drizzle-user-time-zone';
import {
  convertAmount as budgetConvertAmount,
  effectiveNames as budgetEffectiveNames,
  spendingOf,
  type PersonalRow,
  type ShareRow,
} from '../../src/budgets/domain/spending';
import { GetExpensesByCategory } from '../../src/reports/application/get-expenses-by-category';
import { convertAmount, effectiveNames } from '../../src/reports/domain/conversion';
import { convertRows, matchShareCategory } from '../../src/reports/domain/flows';
import { DrizzleFlowReader } from '../../src/reports/infrastructure/db/drizzle-flow-reader';
import { DrizzleReportFilterReader } from '../../src/reports/infrastructure/db/drizzle-report-filter-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { FixedClock as BudgetClock, readScopeFor } from '../budgets/fakes';
import { newBudgetWithVersions } from '../budgets/spending-fixtures';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newTransfer, newUserId } from '../movements/db-fixtures';
import { FakePreferences, FixedClock } from './fakes';
import {
  newCard,
  newInstallmentPurchase,
  newMovementAt,
  newNamedCategory,
  newStatement,
} from './flow-fixtures';

const CATEGORY = 'food';

const personalRows: PersonalRow[] = [
  { categoryId: CATEGORY, currency: 'ARS', rate: 14000000n, sum: 5000000n },
  { categoryId: CATEGORY, currency: 'USD', rate: 14012345n, sum: 3333n },
  { categoryId: CATEGORY, currency: 'USD', rate: 15000000n, sum: 1n },
  { categoryId: 'other', currency: 'USD', rate: 15000000n, sum: 9999n },
];

const shareRows: ShareRow[] = [
  { categoryName: 'Food', categoryDefaultKey: null, currency: 'ARS', rate: null, sum: 1000000n },
  { categoryName: 'food', categoryDefaultKey: null, currency: 'USD', rate: 13999999n, sum: 777n },
  { categoryName: 'FOOD', categoryDefaultKey: null, currency: 'USD', rate: null, sum: 500n },
  { categoryName: 'Trips', categoryDefaultKey: null, currency: 'ARS', rate: null, sum: 123n },
];

describe('budgets parity (FR-06)', () => {
  it('gives the same spent amount for the category as computeSpending of the budgets', () => {
    const budget = spendingOf('ARS', new Set([CATEGORY]), ['Food'], personalRows, shareRows);

    const personal = convertRows(
      personalRows
        .filter((row) => row.categoryId === CATEGORY)
        .map((row) => ({ ...row, count: 1 })),
      'ARS',
      'throw',
    );
    const matched = shareRows
      .filter(
        (row) =>
          matchShareCategory({ name: row.categoryName, defaultKey: row.categoryDefaultKey }, [
            { id: CATEGORY, name: 'Food', defaultKey: null, children: [], createdAt: new Date(0) },
          ]) === CATEGORY,
      )
      .map((row) => ({ ...row, count: 1 }));
    const shares = convertRows(matched, 'ARS', 'count');
    const spent = [...personal.items, ...shares.items].reduce((sum, item) => sum + item.amount, 0n);

    expect(spent).toBe(budget.spent);
    expect(shares.unconvertedCount).toBe(budget.unconvertedShareCount);
  });

  it('converts every amount exactly like the budgets in both directions', () => {
    for (const amount of [1n, 99n, 3333n, 5000001n]) {
      for (const rate of [13999999n, 14000000n, 14012345n, null]) {
        for (const [from, to] of [
          ['USD', 'ARS'],
          ['ARS', 'USD'],
          ['ARS', 'ARS'],
        ] as const) {
          expect(convertAmount(amount, from, to, rate)).toBe(
            budgetConvertAmount(amount, from, to, rate),
          );
        }
      }
    }
  });

  it('answers to the same names as the budgets', () => {
    for (const category of [
      { name: 'Super', defaultKey: 'food' },
      { name: null, defaultKey: 'food' },
      { name: null, defaultKey: null },
    ]) {
      expect(effectiveNames(category)).toEqual(budgetEffectiveNames(category));
    }
  });
});

describe('budgets and reports agree on card purchases and installments (FR-08, AC-05, AC-08)', () => {
  const NOW = new Date('2027-01-15T16:00:00.000Z');
  const MONTHS = [
    ['2026-08', '2026-08-31'],
    ['2026-09', '2026-09-30'],
    ['2026-10', '2026-10-31'],
    ['2026-11', '2026-11-30'],
    ['2026-12', '2026-12-31'],
  ] as const;
  let connection: DatabaseConnection;
  let budgets: ListBudgetSpending;
  let reports: GetExpensesByCategory;

  beforeAll(() => {
    connection = createDatabase(testDatabaseUrl);
    budgets = new ListBudgetSpending({
      clock: new BudgetClock(NOW),
      timeZones: new DrizzleUserTimeZone(connection.db),
      versions: new DrizzleBudgetVersionReader(connection.db),
      spending: new DrizzleSpendingReader(connection.db),
    });
    reports = new GetExpensesByCategory({
      clock: new FixedClock(NOW),
      preferences: new FakePreferences(),
      filters: new DrizzleReportFilterReader(connection.db),
      flows: new DrizzleFlowReader(connection.db),
    });
  });

  afterAll(async () => {
    await connection.pool.end();
  });

  /**
   * One user with a top-level category and a budget covering it. A budget matches the exact category
   * id and a report rolls up to the top category, so the two only agree on a top-level category.
   */
  async function world() {
    const ana = await newUserId(connection.db);
    const food = await newNamedCategory(connection.pool, ana, { name: 'Food' });
    const budgetId = await newBudgetWithVersions(connection.pool, {
      ownerId: ana,
      versions: [{ effectiveFrom: '2026-01-01', amount: 99999999n, categoryIds: [food] }],
    });
    return {
      ana,
      food,
      budgetId,
      scope: await readScopeFor(ana),
      bank: await newAccount(connection.pool, ana, false, 'ARS'),
      newCardWith: async (days: { closingDay: number; dueDay: number }) => {
        const ars = await newAccount(connection.pool, ana, false, 'ARS');
        const usd = await newAccount(connection.pool, ana, false, 'USD');
        const cardId = await newCard(connection.pool, {
          ownerId: ana,
          arsAccountId: ars,
          usdAccountId: usd,
          ...days,
        });
        return { cardId, ars, usd };
      },
    };
  }

  type World = Awaited<ReturnType<typeof world>>;

  async function spentBy(w: World, month: string, lastDay: string) {
    const budget = (await budgets.execute(w.scope, month)).budgets.find(
      (item) => item.budgetId === w.budgetId,
    );
    const report = await reports.execute(w.scope, { from: `${month}-01`, to: lastDay });
    const row = report.categories.find((item) => item.categoryId === w.food);
    return {
      budget: budget?.spent ?? 0n,
      report: BigInt(row?.amount ?? '0'),
      budgetUnconverted: budget?.unconvertedInstallmentCount ?? 0,
      reportUnconverted: report.unconvertedInstallmentCount,
    };
  }

  async function everyMonth(w: World) {
    const out: Record<string, { budget: bigint; report: bigint }> = {};
    for (const [month, lastDay] of MONTHS) {
      const spent = await spentBy(w, month, lastDay);
      expect(spent.budgetUnconverted).toBe(spent.reportUnconverted);
      out[month] = { budget: spent.budget, report: spent.report };
    }
    return out;
  }

  const expense = (
    w: World,
    accountId: string,
    amount: bigint,
    occurredAt: string,
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

  it('count the same card purchases, installments and fallback cycles in the same months', async () => {
    const w = await world();
    const stored = await w.newCardWith({ closingDay: 24, dueDay: 5 });
    for (const [period, closingDate, dueDate] of [
      ['2026-09', '2026-09-24', '2026-10-05'],
      ['2026-10', '2026-10-24', '2026-11-05'],
    ] as const) {
      await newStatement(connection.pool, {
        cardId: stored.cardId,
        ownerId: w.ana,
        period,
        closingDate,
        dueDate,
      });
    }
    // The 30,000.00 ARS purchase of 2026-09-20 is due on 5 Oct.
    await expense(w, stored.ars, 3000000n, '2026-09-20T15:00:00Z');
    // 20.00 USD frozen at 1,500.0000 on the same statement: 30,000.00 ARS.
    await expense(w, stored.usd, 2000n, '2026-09-21T15:00:00Z', 15000000n);
    // After the 24 Sep closing: the next statement, due 5 Nov.
    await expense(w, stored.ars, 1200000n, '2026-09-25T15:00:00Z');
    // After the last stored closing (24 Oct): the computed cycle, due 5 Dec.
    await expense(w, stored.ars, 700000n, '2026-10-30T15:00:00Z');
    // A card with no stored statement at all: the cycle its days give, due 5 Oct.
    const bare = await w.newCardWith({ closingDay: 24, dueDay: 5 });
    await expense(w, bare.ars, 500000n, '2026-09-20T15:00:00Z');
    // 60,000.00 ARS in 6 payments of 10,000.00: Oct and Nov stored, Dec computed, then 2027.
    await newInstallmentPurchase(connection.pool, {
      ownerId: w.ana,
      cardId: stored.cardId,
      categoryId: w.food,
      installments: ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02'].map(
        (period) => ({ period, amount: 1000000n }),
      ),
    });
    // An 8,000.00 ARS expense on a bank account stays in its own month.
    await expense(w, w.bank, 800000n, '2026-09-20T15:00:00Z');

    const months = await everyMonth(w);

    for (const spent of Object.values(months)) expect(spent.budget).toBe(spent.report);
    expect(months['2026-08']?.budget).toBe(0n);
    expect(months['2026-09']?.budget).toBe(800000n);
    expect(months['2026-10']?.budget).toBe(3000000n + 3000000n + 500000n + 1000000n);
    expect(months['2026-11']?.budget).toBe(1200000n + 1000000n);
    expect(months['2026-12']?.budget).toBe(700000n + 1000000n);
  });

  it('count the 6 installments of a purchase in the same statement months', async () => {
    const w = await world();
    const card = await w.newCardWith({ closingDay: 24, dueDay: 5 });
    await newInstallmentPurchase(connection.pool, {
      ownerId: w.ana,
      cardId: card.cardId,
      categoryId: w.food,
      installments: ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'].map(
        (period) => ({ period, amount: 1000000n }),
      ),
    });

    const months = await everyMonth(w);

    // No statement is stored: each period is due the month after it.
    expect(months['2026-08']).toEqual({ budget: 1000000n, report: 1000000n });
    expect(months['2026-09']).toEqual({ budget: 1000000n, report: 1000000n });
    expect(months['2026-10']).toEqual({ budget: 1000000n, report: 1000000n });
    expect(months['2026-11']).toEqual({ budget: 1000000n, report: 1000000n });
    expect(months['2026-12']).toEqual({ budget: 1000000n, report: 1000000n });
  });

  it('count a statement payment, a transfer to the card, in neither (AC-08)', async () => {
    const w = await world();
    const card = await w.newCardWith({ closingDay: 24, dueDay: 5 });
    await newTransfer(connection.pool, {
      ownerId: w.ana,
      accountId: w.bank,
      destinationAccountId: card.ars,
      amount: 3000000n,
    });
    // A purchase beside the payment is the control: only it is spending, so a zero is not vacuous.
    await expense(w, card.ars, 1000000n, '2026-09-20T15:00:00.000Z', 10000n);

    const months = await everyMonth(w);

    expect(months['2026-10']).toEqual({ budget: 1000000n, report: 1000000n });
    for (const [month, spent] of Object.entries(months)) {
      if (month !== '2026-10') expect(spent).toEqual({ budget: 0n, report: 0n });
    }
  });
});
