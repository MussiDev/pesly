import { describe, expect, it } from 'vitest';
import { dashboardResponseSchema } from '@pesly/shared';
import {
  toDashboardView,
  toSeriesView,
} from '../src/features/dashboard/contract/dashboard-adapter';
import {
  formatCount,
  formatSignedPercent,
  formatWholePercent,
} from '../src/features/dashboard/format';

const ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const ID2 = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';
const OTHER = 'Other';

const PARTS = {
  accounts: { ars: '90000000', usd: '100000' },
  investments: { ars: '10000000', usd: '0' },
  groups: { ars: '0', usd: '0' },
  installmentDebt: { ars: '0', usd: '0' },
};

// A body in the shape of the shared schema (packages/shared/src/dashboard/dashboard.ts).
function body(patch: Record<string, unknown> = {}) {
  return {
    currency: 'ARS',
    today: '2026-10-12',
    netWorth: {
      ars: '100000000',
      usd: '100000',
      total: '142000000',
      reason: null,
      holdingsWithoutPrice: 2,
      parts: PARTS,
    },
    month: {
      from: '2026-10-01',
      to: '2026-10-12',
      expenses: '24000000',
      income: '80000000',
      net: '-5600',
      change: { expenses: 20, income: null, net: -5 },
      unconvertedShareCount: 1,
      unconvertedInstallmentCount: 2,
    },
    categories: [],
    budgets: [],
    upcoming: [],
    actions: [],
    groups: { owedToYou: { ars: '3000000', usd: '0' }, youOwe: { ars: '0', usd: '5000' } },
    insight: null,
    firstSteps: { hasAccount: true, hasMovement: false, show: false },
    ...patch,
  };
}

function raw(patch: Record<string, unknown> = {}) {
  return dashboardResponseSchema.parse(body(patch));
}

const view = (patch: Record<string, unknown> = {}, locale: 'es' | 'en' = 'en') =>
  toDashboardView(raw(patch), { locale, otherLabel: OTHER });

describe('toDashboardView', () => {
  it('turns amount strings into bigint and keeps the currency, ARS and USD (AC-01, AC-50)', () => {
    const result = view();
    expect(result.currency).toBe('ARS');
    expect(result.netWorth.total).toBe(142000000n);
    expect(result.netWorth.ars).toBe(100000000n);
    expect(result.netWorth.usd).toBe(100000n);
    expect(result.netWorth.holdingsWithoutPrice).toBe(2);
    expect(result.month.net.value).toBe(-5600n);
    expect(result.month.leftOutCount).toBe(3);
    expect(view({ currency: 'USD' }).currency).toBe('USD');
  });

  it('keeps both parts and no total on no_rate, and a null change null (AC-05, AC-09)', () => {
    const result = view({
      netWorth: {
        ars: '5',
        usd: '7',
        total: null,
        reason: 'no_rate',
        holdingsWithoutPrice: 0,
        parts: PARTS,
      },
    });
    expect(result.netWorth).toMatchObject({ total: null, reason: 'no_rate', ars: 5n, usd: 7n });
    expect(result.month.income.change).toBeNull();
    expect(result.month.expenses.change).toBe(20);
  });

  it('keeps the budget statuses and their order (AC-17)', () => {
    const budgets = (['over', 'close', 'on_track'] as const).map((status, i) => ({
      budgetId: ID,
      name: `B${i}`,
      currency: 'USD',
      available: '1000',
      spent: '500',
      percentUsed: 120 - i * 40,
      status,
    }));
    const result = view({ budgets });
    expect(result.budgets.map((b) => b.status)).toEqual(['over', 'close', 'on_track']);
    expect(result.budgets[0]).toMatchObject({ id: ID, currency: 'USD', percent: 120 });
    expect(result.budgets[0]?.href).toBe(`/budgets/${ID}`);
  });

  it('names categories in the active language, then the response name, then the generic label (AC-48)', () => {
    const categories = [
      { categoryId: null, defaultKey: 'food', name: null, amount: '1', sharePercent: 50 },
      { categoryId: ID, defaultKey: 'nope-unknown', name: 'Mine', amount: '2', sharePercent: 30 },
      { categoryId: ID2, defaultKey: 'nope-unknown', name: null, amount: '3', sharePercent: 20 },
      { categoryId: null, defaultKey: null, name: '  ', amount: '4', sharePercent: 0 },
    ];
    const en = view({ categories }, 'en').categories;
    const es = view({ categories }, 'es').categories;
    expect(en[0]?.label).toBe('Food');
    expect(es[0]?.label).toBe('Comida');
    expect(en[1]?.label).toBe('Mine');
    expect(en[2]?.label).toBe(OTHER);
    expect(en[3]?.label).toBe(OTHER);
    expect(new Set(en.map((c) => c.key)).size).toBe(4);
    expect(en[0]?.amount).toBe(1n);
  });

  it('builds links from the real ids of each union member (AC-21)', () => {
    const result = view({
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
          cardId: ID2,
          statementId: ID,
          date: '2026-10-18',
          name: 'Visa',
          currency: 'USD',
          amount: '50',
        },
      ],
      actions: [
        { kind: 'overdue_occurrence', dueDate: '2026-10-01', name: 'Gym', occurrenceId: ID },
        { kind: 'pending_occurrence', dueDate: '2026-10-12', name: 'Rent', occurrenceId: ID2 },
        {
          kind: 'unpaid_statement',
          dueDate: '2026-10-05',
          name: 'Visa',
          statementId: ID,
          cardId: ID2,
        },
        {
          kind: 'unpaid_statement',
          dueDate: '2026-10-12',
          name: 'Master',
          statementId: ID,
          cardId: ID2,
        },
      ],
    });
    // The web has no statement route and no occurrence route: cards go to the card, occurrences
    // to the recurring list.
    expect(result.upcoming.map((u) => u.href)).toEqual([`/recurring/${ID}`, `/cards/${ID2}`]);
    expect(result.upcoming[0]).toMatchObject({ name: 'Rent', amount: 100n, currency: 'ARS' });
    expect(result.upcoming[1]).toMatchObject({
      kind: 'card_statement',
      amount: 50n,
      currency: 'USD',
    });
    expect(result.actions.map((a) => a.href)).toEqual([
      '/recurring',
      '/recurring',
      `/cards/${ID2}`,
      `/cards/${ID2}`,
    ]);
    expect(result.actions[0]).toMatchObject({ date: '2026-10-01', amount: null, currency: null });
    expect(result.actions.map((a) => a.overdue)).toEqual([true, false, true, false]);
  });

  it('rejects a non-UUID id in an entry and an unknown kind at the parser', () => {
    const upcoming = {
      kind: 'recurring_payment',
      date: '2026-10-15',
      name: 'x',
      currency: 'ARS',
      amount: '1',
    };
    expect(() => raw({ upcoming: [{ ...upcoming, paymentId: '../x' }] })).toThrow();
    expect(() => raw({ upcoming: [{ ...upcoming, kind: 'weird', paymentId: ID }] })).toThrow();
  });

  it('maps groups, insight and first steps', () => {
    const result = view({
      insight: {
        categoryId: null,
        defaultKey: 'food',
        name: null,
        amount: '10',
        sharePercent: 32,
        changePercent: 40,
      },
    });
    expect(result.groups.owedToYou).toEqual({ ARS: 3000000n, USD: 0n });
    expect(result.groups.youOwe).toEqual({ ARS: 0n, USD: 5000n });
    expect(result.insight).toEqual({ label: 'Food', share: 32, change: 40 });
    expect(result.firstSteps).toEqual({ hasAccount: true, hasMovement: false, show: false });
    expect(view().insight).toBeNull();
  });
});

describe('toSeriesView', () => {
  it('maps points to bigint and keeps null totals with their reason (AC-10, AC-12)', () => {
    const points = toSeriesView({
      currency: 'ARS',
      from: '2026-01-31',
      to: '2026-02-28',
      points: [
        {
          date: '2026-01-31',
          ars: '1',
          usd: '2',
          total: '3',
          reason: null,
          investmentsIncomplete: false,
        },
        {
          date: '2026-02-28',
          ars: '4',
          usd: '5',
          total: null,
          reason: 'no_rate',
          investmentsIncomplete: false,
        },
      ],
    });
    expect(points.points).toEqual([
      { date: '2026-01-31', ars: 1n, usd: 2n, total: 3n, reason: null },
      { date: '2026-02-28', ars: 4n, usd: 5n, total: null, reason: 'no_rate' },
    ]);
  });

  it('keeps the currency the series was requested in', () => {
    const base = { from: '2026-01-31', to: '2026-01-31', points: [] };
    expect(toSeriesView({ ...base, currency: 'USD' }).currency).toBe('USD');
    expect(toSeriesView({ ...base, currency: 'ARS' }).currency).toBe('ARS');
  });
});

describe('dashboard formatters', () => {
  it('formatSignedPercent gives +20%, -5% and 0% in es and en (AC-08, AC-47)', () => {
    for (const locale of ['es', 'en'] as const) {
      expect(formatSignedPercent(20, locale)).toBe('+20%');
      expect(formatSignedPercent(-5, locale)).toBe('−5%');
      expect(formatSignedPercent(0, locale)).toBe('0%');
    }
  });

  it('formats whole percents and counts with the locale grouping', () => {
    expect(formatWholePercent(60, 'en')).toBe('60%');
    expect(formatWholePercent(100000, 'en')).toBe('100,000%');
    expect(formatWholePercent(100000, 'es')).toBe('100.000%');
    expect(formatCount(1234, 'en')).toBe('1,234');
    expect(formatCount(1234, 'es')).toBe('1.234');
  });
});
