import { describe, expect, it } from 'vitest';
import { dashboardQuerySchema, dashboardResponseSchema } from '../src';

const ID = '5f0d3c1e-1b0a-4c55-8f4a-2f3b6f2d9a10';
const pair = { ars: '100', usd: '5' };

function base() {
  return {
    currency: 'ARS',
    today: '2026-10-12',
    netWorth: {
      ars: '142000000',
      usd: '98000',
      total: '150000000' as string | null,
      reason: null as string | null,
      holdingsWithoutPrice: 0,
      parts: {
        accounts: { ...pair },
        investments: { ...pair },
        groups: { ...pair },
        installmentDebt: { ...pair },
      },
    },
    month: {
      from: '2026-10-01',
      to: '2026-10-12',
      expenses: '24000000',
      income: '80000000',
      net: '56000000',
      change: {
        expenses: 20 as number | null,
        income: null as number | null,
        net: -5 as number | null,
      },
      unconvertedShareCount: 0,
      unconvertedInstallmentCount: 1,
    },
    categories: [
      { categoryId: ID, name: 'Food', defaultKey: null, amount: '12000000', sharePercent: 60 },
    ],
    budgets: [
      {
        budgetId: ID,
        name: 'Food',
        currency: 'ARS',
        available: '100',
        spent: '50',
        percentUsed: 50,
        status: 'on_track',
      },
    ],
    upcoming: [
      {
        kind: 'recurring_payment',
        paymentId: ID,
        date: '2026-10-15',
        name: 'Rent',
        currency: 'ARS',
        amount: '100',
      },
      {
        kind: 'card_statement',
        cardId: ID,
        statementId: ID,
        date: '2026-10-18',
        name: 'Visa',
        currency: 'USD',
        amount: '100',
      },
    ],
    actions: [
      { kind: 'overdue_occurrence', dueDate: '2026-10-10', name: 'Rent', occurrenceId: ID },
      {
        kind: 'unpaid_statement',
        dueDate: '2026-10-14',
        name: 'Visa',
        statementId: ID,
        cardId: ID,
      },
    ],
    groups: { owedToYou: { ...pair }, youOwe: { ...pair } },
    insight: {
      categoryId: ID,
      name: 'Restaurants',
      defaultKey: null,
      amount: '100',
      sharePercent: 32,
      changePercent: 40 as number | null,
    },
    firstSteps: { hasAccount: true, hasMovement: true, show: false },
  };
}

function first<T>(list: T[]): T {
  const item = list[0];
  if (item === undefined) throw new Error('empty list');
  return item;
}

type Dashboard = ReturnType<typeof base>;

const valid = (value: unknown): boolean => dashboardResponseSchema.safeParse(value).success;

describe('dashboard contracts', () => {
  it('parses a complete response with the nine sections (AC-01)', () => {
    const parsed = dashboardResponseSchema.parse(base());
    for (const key of [
      'netWorth',
      'month',
      'categories',
      'budgets',
      'upcoming',
      'actions',
      'groups',
      'insight',
      'firstSteps',
    ]) {
      expect(parsed).toHaveProperty(key);
    }
  });

  it('accepts a null insight, a null change and a null category (AC-25)', () => {
    const data = base();
    expect(
      valid({
        ...data,
        insight: null,
        categories: [
          { categoryId: null, name: null, defaultKey: null, amount: '1', sharePercent: 100 },
        ],
      }),
    ).toBe(true);
    expect(valid({ ...data, insight: { ...data.insight, changePercent: null } })).toBe(true);
  });

  it('accepts no query key and rejects any key (AC-02)', () => {
    expect(dashboardQuerySchema.safeParse({}).success).toBe(true);
    expect(dashboardQuerySchema.safeParse({ from: '2026-10-01' }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ x: '1' }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ q: '' }).success).toBe(false);
  });

  const amountFields: Array<[string, (v: Dashboard) => Record<string, unknown>, string[]]> = [
    ['netWorth', (v) => v.netWorth, ['ars', 'usd', 'total']],
    ['parts', (v) => v.netWorth.parts.accounts, ['ars', 'usd']],
    ['month', (v) => v.month, ['expenses', 'income', 'net']],
    ['category', (v) => first(v.categories), ['amount']],
    ['budget', (v) => first(v.budgets), ['available', 'spent']],
    ['upcoming', (v) => first(v.upcoming), ['amount']],
    ['groups', (v) => v.groups.owedToYou, ['ars', 'usd']],
    ['insight', (v) => v.insight, ['amount']],
  ];

  it.each([['12.5'], ['1e3'], [''], [142000000]])(
    'rejects the amount %s in every amount field (AC-03)',
    (bad) => {
      for (const [label, pick, fields] of amountFields) {
        for (const field of fields) {
          const data = base();
          pick(data)[field] = bad;
          expect(valid(data), `${label}.${field}`).toBe(false);
        }
      }
    },
  );

  it('accepts the integer string 142000000 (AC-03)', () => {
    for (const [label, pick, fields] of amountFields) {
      for (const field of fields) {
        const data = base();
        pick(data)[field] = '142000000';
        expect(valid(data), `${label}.${field}`).toBe(true);
      }
    }
  });

  it('requires exactly one of total and reason (AC-09)', () => {
    const both = base();
    both.netWorth.reason = 'no_rate';
    expect(valid(both)).toBe(false);
    const neither = base();
    neither.netWorth.total = null;
    expect(valid(neither)).toBe(false);
    const noRate = base();
    noRate.netWorth.total = null;
    noRate.netWorth.reason = 'no_rate';
    expect(valid(noRate)).toBe(true);
  });

  it('caps budgets at 3, upcoming at 20 and actions at 20', () => {
    const data = base();
    expect(valid({ ...data, budgets: Array(4).fill(data.budgets[0]) })).toBe(false);
    expect(valid({ ...data, budgets: Array(3).fill(data.budgets[0]) })).toBe(true);
    expect(valid({ ...data, upcoming: Array(21).fill(data.upcoming[0]) })).toBe(false);
    expect(valid({ ...data, upcoming: Array(20).fill(data.upcoming[0]) })).toBe(true);
    expect(valid({ ...data, actions: Array(21).fill(data.actions[0]) })).toBe(false);
    expect(valid({ ...data, actions: Array(20).fill(data.actions[0]) })).toBe(true);
  });

  it('bounds percentages to +/-1,000,000 and percentUsed to 1,000', () => {
    const over = base();
    first(over.budgets).percentUsed = 1001;
    expect(valid(over)).toBe(false);
    const edge = base();
    first(edge.budgets).percentUsed = 1000;
    expect(valid(edge)).toBe(true);
    const high = base();
    high.month.change.expenses = 1_000_001;
    expect(valid(high)).toBe(false);
    const low = base();
    low.month.change.net = -1_000_001;
    expect(valid(low)).toBe(false);
    const max = base();
    max.month.change.expenses = 1_000_000;
    expect(valid(max)).toBe(true);
    const fractional = base();
    fractional.month.change.expenses = 1.5;
    expect(valid(fractional)).toBe(false);
    const insight = base();
    insight.insight.changePercent = 1_000_001;
    expect(valid(insight)).toBe(false);
  });

  it('rejects a status outside the three values and an unknown kind', () => {
    const data = base();
    first(data.budgets).status = 'warning';
    expect(valid(data)).toBe(false);
    for (const status of ['on_track', 'close', 'over']) {
      const ok = base();
      first(ok.budgets).status = status;
      expect(valid(ok)).toBe(true);
    }
    const kind = base();
    first(kind.actions).kind = 'other';
    expect(valid(kind)).toBe(false);
  });
});
