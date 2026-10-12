import { describe, expect, it } from 'vitest';
import { listGroupExpensesQuerySchema } from '../src/groups/expense';
import {
  GROUP_EXPENSE_CATEGORY_FILTER_MAX,
  GROUP_EXPENSE_RANGE_MAX_DAYS,
  groupExpenseSummaryQuerySchema,
  groupExpenseSummaryResponseSchema,
} from '../src/groups/expense-summary';

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const ids = (n: number): string => Array.from({ length: n }, (_, i) => uuid(i + 1)).join(',');
const FROM = '2026-10-01T03:00:00.000Z';
const TO = '2026-10-31T02:59:59.999Z';
const DAY = 24 * 60 * 60 * 1000;
const plusDays = (iso: string, days: number): string =>
  new Date(Date.parse(iso) + days * DAY).toISOString();

describe('list query filter', () => {
  it('parses 1 and 50 distinct ids with a valid range', () => {
    expect(GROUP_EXPENSE_CATEGORY_FILTER_MAX).toBe(50);
    const one = listGroupExpensesQuerySchema.parse({ categoryIds: ids(1), from: FROM, to: TO });
    expect(one.categoryIds).toEqual([uuid(1)]);
    expect(one.from).toBe(FROM);
    const fifty = listGroupExpensesQuerySchema.parse({ categoryIds: ids(50) });
    expect(fifty.categoryIds).toHaveLength(50);
  });

  it.each([
    ['non-uuid', 'abc'],
    ['empty entry', `${uuid(1)},,${uuid(2)}`],
    ['empty string', ''],
    ['repeated id', `${uuid(1)},${uuid(1)}`],
    ['51 ids', ids(51)],
  ])('rejects %s', (_name, categoryIds) => {
    expect(listGroupExpensesQuerySchema.safeParse({ categoryIds }).success).toBe(false);
  });

  it('rejects a reversed range, accepts 366 days and rejects 367', () => {
    expect(GROUP_EXPENSE_RANGE_MAX_DAYS).toBe(366);
    expect(listGroupExpensesQuerySchema.safeParse({ from: TO, to: FROM }).success).toBe(false);
    expect(
      listGroupExpensesQuerySchema.safeParse({ from: FROM, to: plusDays(FROM, 366) }).success,
    ).toBe(true);
    expect(
      listGroupExpensesQuerySchema.safeParse({ from: FROM, to: plusDays(FROM, 367) }).success,
    ).toBe(false);
  });

  it('still accepts the old shape and rejects unknown keys', () => {
    expect(listGroupExpensesQuerySchema.safeParse({ limit: '10' }).success).toBe(true);
    expect(listGroupExpensesQuerySchema.safeParse({ other: '1' }).success).toBe(false);
  });
});

describe('summary query', () => {
  it('parses with both bounds', () => {
    expect(groupExpenseSummaryQuerySchema.parse({ from: FROM, to: TO })).toEqual({
      from: FROM,
      to: TO,
    });
  });

  it('rejects a missing bound, an extra key and a bad range', () => {
    expect(groupExpenseSummaryQuerySchema.safeParse({ to: TO }).success).toBe(false);
    expect(groupExpenseSummaryQuerySchema.safeParse({ from: FROM }).success).toBe(false);
    expect(groupExpenseSummaryQuerySchema.safeParse({ from: FROM, to: TO, x: 1 }).success).toBe(
      false,
    );
    expect(groupExpenseSummaryQuerySchema.safeParse({ from: TO, to: FROM }).success).toBe(false);
  });
});

describe('summary response', () => {
  const category = {
    id: uuid(1),
    name: 'Food',
    icon: 'utensils',
    color: 'orange',
    defaultKey: null,
    archivedAt: null,
  };
  const body = {
    from: FROM,
    to: TO,
    currencies: [
      {
        currency: 'ARS',
        total: '15000',
        count: 2,
        categories: [{ categoryId: uuid(1), total: '15000', count: 2 }],
      },
    ],
    categories: [category],
  };

  it('accepts the documented shape', () => {
    expect(groupExpenseSummaryResponseSchema.safeParse(body).success).toBe(true);
  });

  it('rejects a numeric total, a negative total and an unknown currency', () => {
    const withTotal = (total: unknown) => ({
      ...body,
      currencies: [{ ...body.currencies[0], total }],
    });
    expect(groupExpenseSummaryResponseSchema.safeParse(withTotal(15000)).success).toBe(false);
    expect(groupExpenseSummaryResponseSchema.safeParse(withTotal('-1')).success).toBe(false);
    expect(
      groupExpenseSummaryResponseSchema.safeParse({
        ...body,
        currencies: [{ ...body.currencies[0], currency: 'EUR' }],
      }).success,
    ).toBe(false);
  });
});
