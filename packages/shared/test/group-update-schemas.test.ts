import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/errors';
import { updateGroupExpenseRequestSchema } from '../src/groups/expense';
import { updateSettlementRequestSchema } from '../src/groups/settlement';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CAT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-10-10T12:00:00.000Z';

const expense = {
  amount: '30000',
  occurredAt: NOW,
  categoryId: CAT,
  description: 'Dinner',
  split: { mode: 'equal', memberIds: [A, B] },
};

const okExpense = (input: unknown) => updateGroupExpenseRequestSchema.safeParse(input).success;
const okSettlement = (input: unknown) => updateSettlementRequestSchema.safeParse(input).success;

describe('record change error codes', () => {
  it('declares the four codes', () => {
    for (const code of [
      'GROUP_RECORD_EDIT_FORBIDDEN',
      'GROUP_RECORD_FORMER_MEMBER',
      'GROUP_SETTLEMENT_CONSOLIDATED',
      'GROUP_ACTIVITY_LOG_IMMUTABLE',
    ]) {
      expect(ERROR_CODES as readonly string[]).toContain(code);
    }
  });
});

describe('updateGroupExpenseRequestSchema (AC-07)', () => {
  it('parses a valid full replacement in every split mode', () => {
    expect(okExpense(expense)).toBe(true);
    expect(
      okExpense({
        ...expense,
        split: { mode: 'percentage', shares: [{ memberId: A, basisPoints: 10000 }] },
      }),
    ).toBe(true);
    expect(
      okExpense({
        ...expense,
        split: { mode: 'exact', shares: [{ memberId: A, amount: '30000' }] },
      }),
    ).toBe(true);
  });

  it('is invalid when it names currency, payer, payer account or creator', () => {
    expect(okExpense({ ...expense, currency: 'USD' })).toBe(false);
    expect(okExpense({ ...expense, payerMemberId: A })).toBe(false);
    expect(okExpense({ ...expense, payerAccount: { accountId: A, categoryId: CAT } })).toBe(false);
    expect(okExpense({ ...expense, createdByMemberId: A })).toBe(false);
    expect(okExpense({ ...expense, extra: 1 })).toBe(false);
  });

  it('is invalid when a field is missing: the edit is a full replacement', () => {
    for (const key of Object.keys(expense)) {
      const partial = Object.fromEntries(Object.entries(expense).filter(([name]) => name !== key));
      expect(okExpense(partial)).toBe(false);
    }
  });

  it('is invalid with a zero, negative, decimal or numeric amount, or a bad description', () => {
    for (const amount of ['0', '-5', '10.5', '', '01', 100]) {
      expect(okExpense({ ...expense, amount })).toBe(false);
    }
    expect(okExpense({ ...expense, description: '' })).toBe(false);
    expect(okExpense({ ...expense, description: 'x'.repeat(201) })).toBe(false);
    expect(okExpense({ ...expense, occurredAt: 'yesterday' })).toBe(false);
  });
});

describe('updateSettlementRequestSchema (AC-04)', () => {
  it('parses an amount, a date or both', () => {
    expect(okSettlement({ amount: '5000' })).toBe(true);
    expect(okSettlement({ occurredAt: NOW })).toBe(true);
    expect(okSettlement({ amount: '5000', occurredAt: NOW })).toBe(true);
  });

  it('is invalid with no key at all', () => {
    expect(okSettlement({})).toBe(false);
  });

  it('is invalid with an amount of 0, a decimal amount or an extra key', () => {
    for (const amount of ['0', '-1', '1.5', '', 10]) {
      expect(okSettlement({ amount })).toBe(false);
    }
    expect(okSettlement({ amount: '5000', currency: 'USD' })).toBe(false);
    expect(okSettlement({ amount: '5000', fromMemberId: A })).toBe(false);
    expect(okSettlement({ amount: '5000', accountId: A })).toBe(false);
  });

  it('is invalid with an undefined-only body and a bad date', () => {
    expect(okSettlement({ amount: undefined })).toBe(false);
    expect(okSettlement({ occurredAt: 'nope' })).toBe(false);
  });
});
