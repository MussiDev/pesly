import { describe, expect, it } from 'vitest';
import { addToCategory, orderCategoryTotals } from '../../src/reports/domain/category-totals';

describe('category totals', () => {
  it('adds amounts of the same category and keeps the null category apart', () => {
    const totals = new Map<string | null, bigint>();
    addToCategory(totals, 'a', 100n);
    addToCategory(totals, 'a', 50n);
    addToCategory(totals, null, 7n);

    expect(orderCategoryTotals(totals)).toEqual([
      { categoryId: 'a', amount: 150n },
      { categoryId: null, amount: 7n },
    ]);
  });

  it('orders by amount descending and then by id, the null category last on a tie', () => {
    const totals = new Map<string | null, bigint>([
      ['b', 10n],
      [null, 10n],
      ['a', 10n],
      ['c', 99n],
    ]);

    expect(orderCategoryTotals(totals).map((row) => row.categoryId)).toEqual(['c', 'a', 'b', null]);
  });

  it('returns an empty list for no totals', () => {
    expect(orderCategoryTotals(new Map())).toEqual([]);
  });
});
