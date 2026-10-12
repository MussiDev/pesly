import { describe, expect, it } from 'vitest';
import {
  toCategoriesView,
  toIncomeExpensesView,
  toNetWorthView,
} from '../src/features/reports/report-adapters';

const ID_A = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const ID_B = '4f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a11';
const labels = { groupShares: 'Group shares', unnamed: 'Unnamed' };

describe('report adapters', () => {
  it('toCategoriesView sorts from the largest, names the rows and computes the shares (AC-08, AC-13)', () => {
    const view = toCategoriesView(
      {
        currency: 'ARS',
        from: '2026-10-01',
        to: '2026-10-12',
        total: '20000000',
        categories: [
          { categoryId: ID_B, name: 'Gym', defaultKey: null, amount: '8000000' },
          { categoryId: ID_A, name: null, defaultKey: 'food', amount: '12000000' },
        ],
        unconvertedShareCount: 2,
        unconvertedInstallmentCount: 1,
      },
      'en',
      labels,
    );
    expect(view.total).toBe(20_000_000n);
    expect(view.rows.map((row) => [row.label, row.amount, row.percent])).toEqual([
      ['Food', 12_000_000n, 60],
      ['Gym', 8_000_000n, 40],
    ]);
    expect(view.unconvertedShareCount).toBe(2);
    expect(view.unconvertedInstallmentCount).toBe(1);
  });

  it('toCategoriesView with a total of 0 gives rows at 0% and never throws', () => {
    const view = toCategoriesView(
      {
        currency: 'USD',
        from: '2026-10-01',
        to: '2026-10-12',
        total: '0',
        categories: [{ categoryId: null, name: null, defaultKey: null, amount: '0' }],
        unconvertedShareCount: 0,
        unconvertedInstallmentCount: 0,
      },
      'es',
      labels,
    );
    expect(view.rows).toEqual([
      { key: 'row-0', label: 'Group shares', amount: 0n, percent: 0, underOne: false },
    ]);
  });

  it('toIncomeExpensesView computes the net result in bigint (AC-16)', () => {
    const view = toIncomeExpensesView({
      currency: 'ARS',
      from: '2026-10-01',
      to: '2026-10-12',
      months: [
        { month: '2026-09', income: '1000', expenses: '3000' },
        { month: '2026-10', income: '80000000', expenses: '24000000' },
      ],
      unconvertedShareCount: 0,
      unconvertedInstallmentCount: 0,
    });
    expect(view.months.map((month) => month.net)).toEqual([-2000n, 56_000_000n]);
  });

  it('toNetWorthView keeps a missing total as null with its reason (AC-21)', () => {
    const view = toNetWorthView({
      currency: 'ARS',
      from: '2026-06-30',
      to: '2026-07-31',
      points: [
        {
          date: '2026-06-30',
          ars: '100000000',
          usd: '50000',
          total: null,
          reason: 'no_rate',
          investmentsIncomplete: true,
        },
        {
          date: '2026-07-31',
          ars: '1',
          usd: '0',
          total: '1',
          reason: null,
          investmentsIncomplete: false,
        },
      ],
    });
    expect(view.points[0]).toEqual({
      date: '2026-06-30',
      ars: 100_000_000n,
      usd: 50_000n,
      total: null,
      reason: 'no_rate',
      incomplete: true,
    });
    expect(view.points[1]?.total).toBe(1n);
  });
});
