import { describe, expect, it } from 'vitest';
import { foldMonthlyFlows } from '../../src/reports/domain/monthly-flows';
import { presentIncomeExpenses } from '../../src/reports/infrastructure/http/present-income-expenses';

describe('foldMonthlyFlows', () => {
  it('returns one entry per month in order, zero for a month with no flow (AC-08)', () => {
    const months = foldMonthlyFlows(
      ['2026-08', '2026-09', '2026-10'],
      [{ month: '2026-09', amount: 500n }],
      [
        { month: '2026-10', amount: 70n },
        { month: '2026-10', amount: 30n },
      ],
    );

    expect(months).toEqual([
      { month: '2026-08', income: 0n, expenses: 0n },
      { month: '2026-09', income: 500n, expenses: 0n },
      { month: '2026-10', income: 0n, expenses: 100n },
    ]);
  });

  it('ignores amounts outside the listed months', () => {
    const months = foldMonthlyFlows(
      ['2026-10'],
      [{ month: '2026-09', amount: 5n }],
      [{ month: '2026-11', amount: 5n }],
    );

    expect(months).toEqual([{ month: '2026-10', income: 0n, expenses: 0n }]);
  });

  it('throws on an empty month list (a context with no range is invalid)', () => {
    expect(() => foldMonthlyFlows([], [], [])).toThrow(RangeError);
  });
});

describe('presentIncomeExpenses', () => {
  it('writes every amount as an exact integer string, beyond the safe integer range', () => {
    const response = presentIncomeExpenses({
      currency: 'USD',
      from: '2026-10-01',
      to: '2026-10-06',
      months: [{ month: '2026-10', income: 9007199254740993n, expenses: 0n }],
      unconvertedShareCount: 2,
      unconvertedInstallmentCount: 1,
    });

    expect(response.months).toEqual([
      { month: '2026-10', income: '9007199254740993', expenses: '0' },
    ]);
    expect(response.unconvertedShareCount).toBe(2);
    expect(response.unconvertedInstallmentCount).toBe(1);
  });
});
