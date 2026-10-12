import { describe, expect, it } from 'vitest';
import {
  budgetStatus,
  topBudgets,
  type BudgetHighlightInput,
} from '../../src/dashboard/domain/budget-highlights';

function budget(id: string, percentUsed: number, currency: 'ARS' | 'USD' = 'ARS') {
  return {
    budgetId: id,
    name: `Budget ${id}`,
    currency,
    available: 10000n,
    spent: BigInt(percentUsed) * 100n,
    percentUsed,
  } satisfies BudgetHighlightInput;
}

describe('budgetStatus', () => {
  it.each([
    [0, 'on_track'],
    [79, 'on_track'],
    [80, 'close'],
    [99, 'close'],
    [100, 'over'],
    [1000, 'over'],
  ] as const)('%i percent is %s', (percent, status) => {
    expect(budgetStatus(percent)).toBe(status);
  });
});

describe('topBudgets', () => {
  it('keeps the three highest percentages, highest first, with their status', () => {
    const result = topBudgets([
      budget('a', 50),
      budget('b', 85),
      budget('c', 105),
      budget('d', 30),
    ]);

    expect(result.map((row) => [row.budgetId, row.status])).toEqual([
      ['c', 'over'],
      ['b', 'close'],
      ['a', 'on_track'],
    ]);
  });

  it('keeps the older budget first on a tie', () => {
    const result = topBudgets([
      budget('old', 60),
      budget('mid', 90),
      budget('new', 60),
      budget('x', 60),
    ]);

    expect(result.map((row) => row.budgetId)).toEqual(['mid', 'old', 'new']);
  });

  it('keeps each currency and its amounts untouched', () => {
    const result = topBudgets([budget('ars', 40, 'ARS'), budget('usd', 90, 'USD')]);

    expect(result).toEqual([
      { ...budget('usd', 90, 'USD'), status: 'close' },
      { ...budget('ars', 40, 'ARS'), status: 'on_track' },
    ]);
  });

  it('is empty with no budget', () => {
    expect(topBudgets([])).toEqual([]);
  });
});
