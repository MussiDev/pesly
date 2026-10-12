import { describe, expect, it } from 'vitest';
import {
  REPORT_MAX_MONTHS,
  expensesByCategoryResponseSchema,
  incomeExpensesResponseSchema,
  netWorthPointSchema,
  netWorthQuerySchema,
  netWorthResponseSchema,
  reportFlowQuerySchema,
} from '../src';

const ID = '5f0d3c1e-1b0a-4c55-8f4a-2f3b6f2d9a10';

const category = { categoryId: ID, name: 'Food', defaultKey: null, amount: '100' };
const byCategory = {
  currency: 'ARS',
  from: '2026-09-01',
  to: '2026-09-15',
  total: '100',
  categories: [category],
  unconvertedShareCount: 0,
  unconvertedInstallmentCount: 0,
};
const incomeExpenses = {
  currency: 'ARS',
  from: '2026-09-01',
  to: '2026-09-15',
  months: [{ month: '2026-09', income: '5', expenses: '3' }],
  unconvertedShareCount: 1,
  unconvertedInstallmentCount: 2,
};
const point = {
  date: '2026-09-15',
  ars: '1000',
  usd: '20',
  total: '31000',
  reason: null,
  investmentsIncomplete: false,
};

describe('report limits and queries', () => {
  it('declares the month limits', () => {
    expect(REPORT_MAX_MONTHS).toEqual({ expensesByCategory: 24, incomeExpenses: 12, netWorth: 24 });
  });

  it('parses the flow query and normalizes the tag (FR-05)', () => {
    const parsed = reportFlowQuerySchema.parse({
      from: '2026-01-01',
      to: '2026-02-01',
      accountId: ID,
      tag: '  Vacations2026 ',
    });
    expect(parsed.tag).toBe('Vacations2026');
    expect(reportFlowQuerySchema.parse({})).toEqual({});
  });

  it('refuses an unknown key, a bad date, a bad uuid and a bad tag on the flow query', () => {
    expect(reportFlowQuerySchema.safeParse({ extra: '1' }).success).toBe(false);
    expect(reportFlowQuerySchema.safeParse({ from: '2026-02-30' }).success).toBe(false);
    expect(reportFlowQuerySchema.safeParse({ to: '1969-12-31' }).success).toBe(false);
    expect(reportFlowQuerySchema.safeParse({ accountId: 'x' }).success).toBe(false);
    expect(reportFlowQuerySchema.safeParse({ tag: '   ' }).success).toBe(false);
    expect(reportFlowQuerySchema.safeParse({ tag: 'a'.repeat(31) }).success).toBe(false);
  });

  it('refuses accountId and tag on the net worth query (FR-05)', () => {
    expect(netWorthQuerySchema.safeParse({ from: '2026-01-01', to: '2026-02-01' }).success).toBe(
      true,
    );
    expect(netWorthQuerySchema.safeParse({ accountId: ID }).success).toBe(false);
    expect(netWorthQuerySchema.safeParse({ tag: 'x' }).success).toBe(false);
  });
});

describe('response schemas', () => {
  it('parses valid responses, including a null category row', () => {
    expect(expensesByCategoryResponseSchema.safeParse(byCategory).success).toBe(true);
    const nullRow = { categoryId: null, name: null, defaultKey: null, amount: '5' };
    expect(
      expensesByCategoryResponseSchema.safeParse({ ...byCategory, categories: [nullRow] }).success,
    ).toBe(true);
    expect(incomeExpensesResponseSchema.safeParse(incomeExpenses).success).toBe(true);
  });

  it('parses a net worth point with a total or with a no_rate reason (AC-10)', () => {
    expect(netWorthPointSchema.safeParse(point).success).toBe(true);
    expect(
      netWorthPointSchema.safeParse({ ...point, total: null, reason: 'no_rate' }).success,
    ).toBe(true);
    expect(
      netWorthResponseSchema.safeParse({
        currency: 'USD',
        from: '2025-10-01',
        to: '2026-09-15',
        points: [point],
      }).success,
    ).toBe(true);
  });

  it('refuses a point that sets both or neither of total and reason (AC-10)', () => {
    expect(netWorthPointSchema.safeParse({ ...point, reason: 'no_rate' }).success).toBe(false);
    expect(netWorthPointSchema.safeParse({ ...point, total: null }).success).toBe(false);
    expect(netWorthPointSchema.safeParse({ ...point, reason: 'other', total: null }).success).toBe(
      false,
    );
  });

  it('refuses decimal, exponent and numeric amounts in every response schema (AC-48)', () => {
    for (const bad of ['12.5', '1e3', 12]) {
      expect(
        expensesByCategoryResponseSchema.safeParse({ ...byCategory, total: bad }).success,
      ).toBe(false);
      expect(
        expensesByCategoryResponseSchema.safeParse({
          ...byCategory,
          categories: [{ ...category, amount: bad }],
        }).success,
      ).toBe(false);
      expect(
        incomeExpensesResponseSchema.safeParse({
          ...incomeExpenses,
          months: [{ month: '2026-09', income: bad, expenses: '1' }],
        }).success,
      ).toBe(false);
      expect(
        incomeExpensesResponseSchema.safeParse({
          ...incomeExpenses,
          months: [{ month: '2026-09', income: '1', expenses: bad }],
        }).success,
      ).toBe(false);
      expect(netWorthPointSchema.safeParse({ ...point, ars: bad }).success).toBe(false);
      expect(netWorthPointSchema.safeParse({ ...point, usd: bad }).success).toBe(false);
      expect(netWorthPointSchema.safeParse({ ...point, total: bad }).success).toBe(false);
    }
  });

  it('keeps fixed month and date patterns', () => {
    expect(
      incomeExpensesResponseSchema.safeParse({
        ...incomeExpenses,
        months: [{ month: '2026-13', income: '1', expenses: '1' }],
      }).success,
    ).toBe(false);
    expect(netWorthPointSchema.safeParse({ ...point, date: '2026-9-1' }).success).toBe(false);
    expect(
      netWorthPointSchema.safeParse({ ...point, investmentsIncomplete: undefined }).success,
    ).toBe(false);
  });
});
