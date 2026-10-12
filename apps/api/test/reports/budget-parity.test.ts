import { describe, expect, it } from 'vitest';
import {
  convertAmount as budgetConvertAmount,
  effectiveNames as budgetEffectiveNames,
  spendingOf,
  type PersonalRow,
  type ShareRow,
} from '../../src/budgets/domain/spending';
import { convertAmount, effectiveNames } from '../../src/reports/domain/conversion';
import { convertRows, matchShareCategory } from '../../src/reports/domain/flows';

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
