import { describe, expect, it } from 'vitest';
import { foldMonthFlows, type FlowEntry } from '../../src/dashboard/domain/month-flows';

const HISTORY = ['2026-07', '2026-08', '2026-09'];
const FOOD = 'f0000000-0000-4000-8000-000000000001';
const TRANSPORT = 'f0000000-0000-4000-8000-000000000002';
const REST = 'f0000000-0000-4000-8000-000000000003';

function expense(period: string, categoryId: string | null, amount: bigint): FlowEntry {
  return { period, kind: 'expense', categoryId, amount };
}

describe('foldMonthFlows', () => {
  it('totals the current month and the previous period apart', () => {
    const fold = foldMonthFlows(
      [
        expense('current', FOOD, 100n),
        { period: 'current', kind: 'income', categoryId: null, amount: 800n },
        expense('previous', FOOD, 50n),
        { period: 'previous', kind: 'income', categoryId: null, amount: 70n },
        expense('2026-01', FOOD, 999n),
      ],
      HISTORY,
    );

    expect(fold.current.expenses).toBe(100n);
    expect(fold.current.income).toBe(800n);
    expect(fold.previous).toEqual({ expenses: 50n, income: 70n });
  });

  it('ranks categories by amount with their whole percentage of the total', () => {
    const fold = foldMonthFlows(
      [expense('current', TRANSPORT, 8_000_000n), expense('current', FOOD, 12_000_000n)],
      HISTORY,
    );

    expect(fold.current.categories).toEqual([
      { categoryId: FOOD, amount: 12_000_000n, sharePercent: 60n },
      { categoryId: TRANSPORT, amount: 8_000_000n, sharePercent: 40n },
    ]);
  });

  it('gives an empty month no categories and no insight', () => {
    const fold = foldMonthFlows([], HISTORY);

    expect(fold.current).toEqual({ expenses: 0n, income: 0n, categories: [] });
    expect(fold.insight).toBeNull();
  });

  it('reports a change of 40 for 40 percent above the average of the three months', () => {
    const fold = foldMonthFlows(
      [
        expense('current', REST, 140n),
        expense('2026-07', REST, 100n),
        expense('2026-08', REST, 100n),
        expense('2026-09', REST, 100n),
      ],
      HISTORY,
    );

    expect(fold.insight).toEqual({
      categoryId: REST,
      amount: 140n,
      sharePercent: 100n,
      changePercent: 40n,
    });
  });

  it('leaves the change null when fewer than three previous months hold expenses', () => {
    const fold = foldMonthFlows(
      [
        expense('current', REST, 140n),
        expense('2026-08', REST, 100n),
        expense('2026-09', REST, 100n),
      ],
      HISTORY,
    );

    expect(fold.insight?.categoryId).toBe(REST);
    expect(fold.insight?.changePercent).toBeNull();
  });

  it('leaves the change null when the category has no expense in the three months', () => {
    const fold = foldMonthFlows(
      [
        expense('current', REST, 140n),
        expense('2026-07', FOOD, 100n),
        expense('2026-08', FOOD, 100n),
        expense('2026-09', FOOD, 100n),
      ],
      HISTORY,
    );

    expect(fold.insight?.changePercent).toBeNull();
  });

  it('breaks ties by id and puts the null category last', () => {
    const fold = foldMonthFlows(
      [
        expense('current', null, 10n),
        expense('current', TRANSPORT, 10n),
        expense('current', FOOD, 10n),
      ],
      HISTORY,
    );

    expect(fold.current.categories.map((row) => row.categoryId)).toEqual([FOOD, TRANSPORT, null]);
    expect(fold.insight?.categoryId).toBe(FOOD);
  });
});
