import { describe, expect, it } from 'vitest';
import type { AccessScope } from '../../src/shared/access';
import type { FlowReader, FlowWindow, TopCategory } from '../../src/reports';
import type {
  InstallmentFlowRow,
  PersonalFlowRow,
  ShareFlowRow,
} from '../../src/reports/application/ports/flow-reader';
import { GetExpensesByCategory } from '../../src/reports/application/get-expenses-by-category';
import { buildMonthFlows } from '../../src/dashboard/application/build-month-flows';
import { prepareDashboard } from '../../src/dashboard/application/dashboard-context';
import { FakePreferences, FixedClock } from './fakes';
import { FakeFilterReader } from '../reports/fakes';

const USER = '11111111-1111-4111-8111-111111111111';
const SCOPE = { userId: USER } as unknown as AccessScope;
const FOOD = 'f0000000-0000-4000-8000-000000000001';
const GROCERIES_PARENT = FOOD;
const TRANSPORT = 'f0000000-0000-4000-8000-000000000002';
const SALARY = 'f0000000-0000-4000-8000-000000000009';
const NOW = new Date('2026-10-15T16:00:00.000Z');
const RATE = 14_000_000n;

const CATEGORIES: TopCategory[] = [
  {
    id: FOOD,
    name: 'Food',
    defaultKey: null,
    children: [{ name: 'Groceries', defaultKey: null }],
    createdAt: new Date('2026-01-01T00:00:00Z'),
  },
  {
    id: TRANSPORT,
    name: 'Transport',
    defaultKey: null,
    children: [],
    createdAt: new Date('2026-01-02T00:00:00Z'),
  },
];

function personal(
  month: string,
  type: 'expense' | 'income',
  topCategoryId: string,
  sum: bigint,
  extra: Partial<PersonalFlowRow> = {},
): PersonalFlowRow {
  return { month, type, topCategoryId, currency: 'ARS', rate: 10_000n, sum, count: 1, ...extra };
}

function share(month: string, sum: bigint, extra: Partial<ShareFlowRow> = {}): ShareFlowRow {
  return {
    month,
    categoryName: 'Food',
    categoryDefaultKey: null,
    currency: 'ARS',
    rate: null,
    sum,
    count: 1,
    ...extra,
  };
}

function installment(
  dueDate: string,
  topCategoryId: string,
  sum: bigint,
  extra: Partial<InstallmentFlowRow> = {},
): InstallmentFlowRow {
  return {
    period: dueDate.slice(0, 7),
    dueDate,
    closingDay: 25,
    dueDay: 10,
    topCategoryId,
    currency: 'ARS',
    rate: null,
    sum,
    count: 1,
    ...extra,
  };
}

interface Fixture {
  personal?: PersonalFlowRow[];
  previousPersonal?: PersonalFlowRow[];
  shares?: ShareFlowRow[];
  previousShares?: ShareFlowRow[];
  installments?: InstallmentFlowRow[];
  categories?: TopCategory[];
}

const MAIN_WINDOW_MIN_MS = 60 * 24 * 3600 * 1000;

class FakeFlows implements FlowReader {
  calls = { personal: 0, shares: 0, installments: 0, categories: 0 };
  windows: FlowWindow[] = [];
  periods: [string, string][] = [];

  constructor(
    private readonly fixture: Fixture,
    private readonly everyWindowIsMain = false,
  ) {}

  private isMain(window: FlowWindow): boolean {
    return (
      this.everyWindowIsMain || window.before.getTime() - window.from.getTime() > MAIN_WINDOW_MIN_MS
    );
  }

  personalRows(_scope: AccessScope, window: FlowWindow): Promise<PersonalFlowRow[]> {
    this.calls.personal += 1;
    this.windows.push(window);
    return Promise.resolve(
      (this.isMain(window) ? this.fixture.personal : this.fixture.previousPersonal) ?? [],
    );
  }

  shareRows(_scope: AccessScope, window: FlowWindow): Promise<ShareFlowRow[]> {
    this.calls.shares += 1;
    return Promise.resolve(
      (this.isMain(window) ? this.fixture.shares : this.fixture.previousShares) ?? [],
    );
  }

  installmentRows(
    _scope: AccessScope,
    periodFrom: string,
    periodTo: string,
  ): Promise<InstallmentFlowRow[]> {
    this.calls.installments += 1;
    this.periods.push([periodFrom, periodTo]);
    return Promise.resolve(this.fixture.installments ?? []);
  }

  topCategories(): Promise<TopCategory[]> {
    this.calls.categories += 1;
    return Promise.resolve(this.fixture.categories ?? CATEGORIES);
  }
}

async function run(fixture: Fixture, now = NOW) {
  const flows = new FakeFlows(fixture);
  const context = await prepareDashboard(
    { clock: new FixedClock(now), preferences: new FakePreferences() },
    SCOPE,
  );
  const result = await buildMonthFlows({ flows }, SCOPE, context);
  return { result, flows, context };
}

describe('buildMonthFlows', () => {
  it('adds personal expenses, group shares and installments (AC-14)', async () => {
    const { result } = await run({
      personal: [personal('2026-10', 'expense', FOOD, 20_000_000n)],
      shares: [share('2026-10', 3_000_000n)],
      installments: [installment('2026-10-20', TRANSPORT, 1_000_000n)],
    });

    expect(result.month.expenses).toBe(24_000_000n);
    expect(result.month.from).toBe('2026-10-01');
    expect(result.month.to).toBe('2026-10-15');
  });

  it('gives income and net (AC-15)', async () => {
    const { result } = await run({
      personal: [
        personal('2026-10', 'expense', FOOD, 24_000_000n),
        personal('2026-10', 'income', SALARY, 80_000_000n),
      ],
    });

    expect(result.month.income).toBe(80_000_000n);
    expect(result.month.net).toBe(56_000_000n);
  });

  it('converts with the frozen rate of the movement (AC-16)', async () => {
    const { result } = await run({
      personal: [personal('2026-10', 'expense', FOOD, 2_000n, { currency: 'USD', rate: RATE })],
    });

    expect(result.month.expenses).toBe(2_800_000n);
  });

  it('counts only the caller share of a group expense (AC-17)', async () => {
    const { result } = await run({
      shares: [share('2026-10', 1_000_000n, { rate: null })],
    });

    expect(result.month.expenses).toBe(1_000_000n);
  });

  it('leaves out a share and an installment with no rate and counts them (AC-18)', async () => {
    const { result } = await run({
      shares: [share('2026-10', 1_000n, { currency: 'USD', rate: null })],
      installments: [installment('2026-10-20', FOOD, 1_000n, { currency: 'USD' })],
    });

    expect(result.month.expenses).toBe(0n);
    expect(result.month.unconvertedShareCount).toBe(1);
    expect(result.month.unconvertedInstallmentCount).toBe(1);
  });

  it('counts the unconverted rows of the current month only', async () => {
    const { result } = await run({
      shares: [
        share('2026-09', 1_000n, { currency: 'USD', rate: null }),
        share('2026-10', 1_000n, { currency: 'USD', rate: null }),
      ],
      installments: [installment('2026-09-10', FOOD, 1_000n, { currency: 'USD' })],
    });

    expect(result.month.unconvertedShareCount).toBe(1);
    expect(result.month.unconvertedInstallmentCount).toBe(0);
  });

  it('changes 20 percent against the same days of the previous month (AC-20)', async () => {
    const { result } = await run({
      personal: [
        personal('2026-10', 'expense', FOOD, 24_000_000n),
        personal('2026-10', 'income', SALARY, 10_000_000n),
      ],
      previousPersonal: [
        personal('2026-09', 'expense', FOOD, 20_000_000n),
        personal('2026-09', 'income', SALARY, 20_000_000n),
      ],
    });

    expect(result.month.change.expenses).toBe(20);
    expect(result.month.change.income).toBe(-50);
    // net: 10M - 24M = -14M against 20M - 20M = 0
    expect(result.month.change.net).toBeNull();
  });

  it('gives a null change for a previous period of zero (AC-21)', async () => {
    const { result } = await run({
      personal: [personal('2026-10', 'expense', FOOD, 24_000_000n)],
    });

    expect(result.month.change).toEqual({ expenses: null, income: null, net: null });
  });

  it('reads the previous period ending on the clamped day (AC-22)', async () => {
    const { flows } = await run({}, new Date('2026-03-31T16:00:00.000Z'));
    const previous = flows.windows.find(
      (window) => window.before.getTime() - window.from.getTime() < MAIN_WINDOW_MIN_MS,
    );

    // 2026-02-01 to 2026-02-28 in Buenos Aires: 28 days, half open.
    expect(previous).toBeDefined();
    expect(previous && previous.before.getTime() - previous.from.getTime()).toBe(
      28 * 24 * 3600 * 1000,
    );
  });

  it('divides by the absolute value of a negative previous net', async () => {
    const { result } = await run({
      personal: [personal('2026-10', 'income', SALARY, 100n)],
      previousPersonal: [personal('2026-09', 'expense', FOOD, 200n)],
    });

    // net 100 against -200: (100 + 200) * 100 / 200
    expect(result.month.change.net).toBe(150);
  });

  it('ranks categories with the share of the total (AC-23)', async () => {
    const { result } = await run({
      personal: [
        personal('2026-10', 'expense', TRANSPORT, 8_000_000n),
        personal('2026-10', 'expense', FOOD, 12_000_000n),
      ],
    });

    expect(result.categories).toEqual([
      { categoryId: FOOD, name: 'Food', defaultKey: null, amount: 12_000_000n, sharePercent: 60 },
      {
        categoryId: TRANSPORT,
        name: 'Transport',
        defaultKey: null,
        amount: 8_000_000n,
        sharePercent: 40,
      },
    ]);
  });

  it('adds a subcategory expense to its top-level category (AC-24)', async () => {
    const { result } = await run({
      personal: [personal('2026-10', 'expense', GROCERIES_PARENT, 5_000n)],
      shares: [share('2026-10', 1_000n, { categoryName: 'Groceries' })],
    });

    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]).toMatchObject({ categoryId: FOOD, amount: 6_000n });
  });

  it('sends a share that matches no personal category to a null category', async () => {
    const { result } = await run({
      shares: [share('2026-10', 1_000n, { categoryName: 'Trips' })],
    });

    expect(result.categories).toEqual([
      { categoryId: null, name: null, defaultKey: null, amount: 1_000n, sharePercent: 100 },
    ]);
  });

  it('gives an empty month no categories, no insight and zeros (AC-25, AC-41)', async () => {
    const { result } = await run({});

    expect(result.categories).toEqual([]);
    expect(result.insight).toBeNull();
    expect(result.month).toMatchObject({ expenses: 0n, income: 0n, net: 0n });
  });

  it('builds the insight against the three previous months (AC-39)', async () => {
    const { result } = await run({
      personal: [
        personal('2026-10', 'expense', FOOD, 140n),
        personal('2026-10', 'expense', TRANSPORT, 297n),
        personal('2026-07', 'expense', TRANSPORT, 100n),
        personal('2026-08', 'expense', TRANSPORT, 100n),
        personal('2026-09', 'expense', TRANSPORT, 100n),
        personal('2026-07', 'expense', FOOD, 100n),
      ],
    });

    expect(result.insight).toEqual({
      categoryId: TRANSPORT,
      name: 'Transport',
      defaultKey: null,
      amount: 297n,
      sharePercent: 67,
      changePercent: 197,
    });
  });

  it('gives the insight with a null change when fewer than 3 months hold expenses (AC-40)', async () => {
    const { result } = await run({
      personal: [
        personal('2026-10', 'expense', FOOD, 140n),
        personal('2026-09', 'expense', FOOD, 100n),
      ],
    });

    expect(result.insight).toMatchObject({ categoryId: FOOD, changePercent: null });
  });

  it('places installments by due date, the whole month and the history months', async () => {
    const { result, flows } = await run({
      personal: [
        personal('2026-07', 'expense', TRANSPORT, 100n),
        personal('2026-08', 'expense', TRANSPORT, 100n),
        personal('2026-09', 'expense', TRANSPORT, 100n),
      ],
      installments: [
        installment('2026-10-31', TRANSPORT, 7n),
        installment('2026-11-01', TRANSPORT, 1_000n),
        installment('2026-09-10', TRANSPORT, 11n),
      ],
    });

    expect(result.month.expenses).toBe(7n);
    expect(result.insight?.changePercent).toBe(-93);
    expect(flows.periods).toEqual([['2026-05', '2026-12']]);
  });

  it('carries the whole previous month of installments, even those due after today day (D5)', async () => {
    const { result } = await run({
      personal: [personal('2026-10', 'expense', FOOD, 120n)],
      previousPersonal: [personal('2026-09', 'expense', FOOD, 100n)],
      // today is the 15th; this one is due on the 28th of the previous month
      installments: [installment('2026-09-28', TRANSPORT, 100n)],
    });

    // 120 against 100 + 100
    expect(result.month.change.expenses).toBe(-40);
  });

  it('carries the previous-month installments into the net change (D5)', async () => {
    const { result } = await run({
      personal: [personal('2026-10', 'income', SALARY, 500n)],
      previousPersonal: [personal('2026-09', 'income', SALARY, 500n)],
      installments: [installment('2026-09-30', TRANSPORT, 100n)],
    });

    // net 500 against 500 - 100
    expect(result.month.change.net).toBe(25);
  });

  it('makes six reads', async () => {
    const { flows } = await run({});

    expect(flows.calls).toEqual({ personal: 2, shares: 2, installments: 1, categories: 1 });
  });

  it('throws for a personal row with no frozen rate', async () => {
    await expect(
      run({
        personal: [
          personal('2026-10', 'expense', FOOD, 1_000n, {
            currency: 'USD',
            rate: null as unknown as bigint,
          }),
        ],
      }),
    ).rejects.toThrow();
  });

  it('throws for a top-level category missing from the known list', async () => {
    await expect(
      run({ personal: [personal('2026-10', 'expense', SALARY, 1_000n)] }),
    ).rejects.toThrow(/missing/);
  });

  it('rethrows a reader failure with no partial section', async () => {
    const failing: FlowReader = {
      personalRows: () => Promise.reject(new Error('db down')),
      shareRows: () => Promise.resolve([]),
      installmentRows: () => Promise.resolve([]),
      topCategories: () => Promise.resolve([]),
    };
    const context = await prepareDashboard(
      { clock: new FixedClock(NOW), preferences: new FakePreferences() },
      SCOPE,
    );

    await expect(buildMonthFlows({ flows: failing }, SCOPE, context)).rejects.toThrow('db down');
  });

  it('equals the 09a expenses report over the same dates when every installment is due (AC-47)', async () => {
    const fixture: Fixture = {
      personal: [
        personal('2026-10', 'expense', FOOD, 20_000_000n),
        personal('2026-10', 'expense', TRANSPORT, 2_000n, { currency: 'USD', rate: RATE }),
      ],
      shares: [share('2026-10', 3_000_000n)],
      installments: [installment('2026-10-10', TRANSPORT, 1_000_000n)],
    };
    const { result } = await run(fixture);

    const report = await new GetExpensesByCategory({
      clock: new FixedClock(NOW),
      preferences: new FakePreferences(),
      filters: new FakeFilterReader(),
      flows: new FakeFlows(fixture, true),
    }).execute(SCOPE, {});

    expect(result.month.expenses.toString()).toBe(report.total);
  });
});
