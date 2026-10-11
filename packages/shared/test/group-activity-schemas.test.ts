import { describe, expect, it } from 'vitest';
import {
  GROUP_ACTIVITY_ACTIONS,
  activityEntrySchema,
  activityPageSchema,
  expenseSnapshotSchema,
  listActivityQuerySchema,
  settlementSnapshotSchema,
} from '../src/groups/activity';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CAT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-10-10T12:00:00.000Z';

const expenseSnapshot = {
  amount: '30000',
  currency: 'ARS',
  occurredAt: NOW,
  categoryId: CAT,
  description: 'Dinner',
  splitMode: 'equal',
  payerMemberId: A,
  shares: [
    { memberId: A, amount: '15000' },
    { memberId: B, amount: '15000' },
  ],
};

const settlementSnapshot = {
  fromMemberId: A,
  toMemberId: B,
  currency: 'ARS',
  amount: '10000',
  occurredAt: NOW,
  legs: [{ currency: 'ARS', amount: '-10000' }],
};

const entry = {
  id: A,
  action: 'expense_updated',
  subjectType: 'expense',
  subjectId: B,
  memberId: A,
  createdAt: NOW,
  before: expenseSnapshot,
  after: { ...expenseSnapshot, amount: '40000' },
};

const okEntry = (input: unknown) => activityEntrySchema.safeParse(input).success;
const okExpense = (input: unknown) => expenseSnapshotSchema.safeParse(input).success;
const okSettlement = (input: unknown) => settlementSnapshotSchema.safeParse(input).success;

describe('activity actions', () => {
  it('has exactly the six actions of D7', () => {
    expect([...GROUP_ACTIVITY_ACTIONS]).toEqual([
      'expense_created',
      'expense_updated',
      'expense_deleted',
      'settlement_created',
      'settlement_updated',
      'settlement_deleted',
    ]);
  });
});

describe('snapshot schemas keep money as integer strings (NFR-02)', () => {
  it('accepts integer-string amounts', () => {
    expect(okExpense(expenseSnapshot)).toBe(true);
    expect(okSettlement(settlementSnapshot)).toBe(true);
  });

  it('is invalid with a JSON number amount anywhere', () => {
    expect(okExpense({ ...expenseSnapshot, amount: 30000 })).toBe(false);
    expect(okExpense({ ...expenseSnapshot, shares: [{ memberId: A, amount: 15000 }] })).toBe(false);
    expect(okSettlement({ ...settlementSnapshot, amount: 10000 })).toBe(false);
    expect(
      okSettlement({ ...settlementSnapshot, legs: [{ currency: 'ARS', amount: -10000 }] }),
    ).toBe(false);
  });

  it('is invalid with a decimal or malformed string amount anywhere', () => {
    for (const amount of ['300.50', '1e3', '', ' 1', '01', 'NaN']) {
      expect(okExpense({ ...expenseSnapshot, amount })).toBe(false);
      expect(okExpense({ ...expenseSnapshot, shares: [{ memberId: A, amount }] })).toBe(false);
      expect(okSettlement({ ...settlementSnapshot, amount })).toBe(false);
      expect(okSettlement({ ...settlementSnapshot, legs: [{ currency: 'ARS', amount }] })).toBe(
        false,
      );
    }
  });

  it('is invalid with an unknown split mode, currency or extra key', () => {
    expect(okExpense({ ...expenseSnapshot, splitMode: 'weird' })).toBe(false);
    expect(okExpense({ ...expenseSnapshot, currency: 'EUR' })).toBe(false);
    expect(okExpense({ ...expenseSnapshot, extra: 1 })).toBe(false);
    expect(okSettlement({ ...settlementSnapshot, extra: 1 })).toBe(false);
  });
});

describe('activityEntrySchema (AC-08, AC-09, AC-10)', () => {
  it('accepts an update, a deletion (after null) and a creation (both null)', () => {
    expect(okEntry(entry)).toBe(true);
    expect(okEntry({ ...entry, action: 'expense_deleted', after: null })).toBe(true);
    expect(okEntry({ ...entry, action: 'expense_created', before: null, after: null })).toBe(true);
    expect(
      okEntry({
        ...entry,
        action: 'settlement_updated',
        subjectType: 'settlement',
        before: settlementSnapshot,
        after: { ...settlementSnapshot, amount: '12000' },
      }),
    ).toBe(true);
  });

  it('is invalid with an unknown action, an unknown subject type or an extra key', () => {
    expect(okEntry({ ...entry, action: 'expense_archived' })).toBe(false);
    expect(okEntry({ ...entry, subjectType: 'group' })).toBe(false);
    expect(okEntry({ ...entry, extra: 1 })).toBe(false);
  });

  it('is invalid with a snapshot carrying a float amount or a missing snapshot key', () => {
    expect(okEntry({ ...entry, before: { ...expenseSnapshot, amount: '1.5' } })).toBe(false);
    const withoutAfter: Record<string, unknown> = { ...entry };
    delete withoutAfter.after;
    expect(okEntry(withoutAfter)).toBe(false);
  });

  it('parses a page with a cursor and with none', () => {
    expect(activityPageSchema.safeParse({ items: [entry], nextCursor: null }).success).toBe(true);
    expect(activityPageSchema.safeParse({ items: [], nextCursor: 'abc' }).success).toBe(true);
    expect(activityPageSchema.safeParse({ items: [] }).success).toBe(false);
  });
});

describe('listActivityQuerySchema (AC-12)', () => {
  it('accepts no query, a limit from 1 to 100 (coerced) and a cursor', () => {
    expect(listActivityQuerySchema.safeParse({}).success).toBe(true);
    expect(listActivityQuerySchema.parse({ limit: '100', cursor: 'abc' })).toEqual({
      limit: 100,
      cursor: 'abc',
    });
    expect(listActivityQuerySchema.safeParse({ limit: '1' }).success).toBe(true);
  });

  it('is invalid with limit 0, 101, a decimal, an empty cursor or an extra key', () => {
    for (const limit of ['0', '101', '1.5', 'abc']) {
      expect(listActivityQuerySchema.safeParse({ limit }).success).toBe(false);
    }
    expect(listActivityQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
    expect(listActivityQuerySchema.safeParse({ action: 'expense_created' }).success).toBe(false);
  });
});
