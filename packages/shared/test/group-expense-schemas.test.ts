import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/errors';
import {
  createGroupExpenseRequestSchema,
  defaultSplitRequestSchema,
  expenseOptionsResponseSchema,
  groupExpensePageSchema,
  groupExpenseResponseSchema,
  listGroupExpensesQuerySchema,
  personalSharesPageSchema,
  personalSharesQuerySchema,
  splitSchema,
} from '../src/groups/expense';

const A = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const B = '4a1d2b63-7b54-4f1f-8b44-7a2a3c6e8b21';
const C = '5b2e3c74-8c65-4a2a-9c55-8b3b4d7f9c32';
const NOW = '2026-10-10T12:00:00.000Z';

const valid = {
  amount: '10000',
  currency: 'ARS',
  occurredAt: NOW,
  payerMemberId: A,
  categoryId: C,
  description: 'Dinner',
  split: { mode: 'equal', memberIds: [A, B] },
};

describe('group expense error codes', () => {
  it('declares the five codes', () => {
    for (const code of [
      'GROUP_SPLIT_PERCENTAGE_INVALID',
      'GROUP_SPLIT_AMOUNT_MISMATCH',
      'GROUP_SPLIT_MEMBER_INVALID',
      'GROUP_EXPENSE_CATEGORY_INVALID',
      'GROUP_PAYER_ACCOUNT_INVALID',
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });
});

describe('createGroupExpenseRequestSchema', () => {
  it('accepts an equal split without payerAccount', () => {
    expect(createGroupExpenseRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts percentage and exact splits and a payerAccount', () => {
    const percentage = {
      ...valid,
      split: {
        mode: 'percentage',
        shares: [
          { memberId: A, basisPoints: 6000 },
          { memberId: B, basisPoints: 4000 },
        ],
      },
      payerAccount: { accountId: B, categoryId: C },
    };
    const exact = {
      ...valid,
      split: {
        mode: 'exact',
        shares: [
          { memberId: A, amount: '7000' },
          { memberId: B, amount: '0' },
        ],
      },
    };
    expect(createGroupExpenseRequestSchema.safeParse(percentage).success).toBe(true);
    expect(createGroupExpenseRequestSchema.safeParse(exact).success).toBe(true);
  });

  it.each(['0', '-5', '01', '1.5', '', '1000000000000001'])(
    'rejects the amount "%s" (AC-02)',
    (amount) => {
      expect(createGroupExpenseRequestSchema.safeParse({ ...valid, amount }).success).toBe(false);
    },
  );

  it('rejects an extra key at the root, in the split and in payerAccount (AC-02)', () => {
    expect(createGroupExpenseRequestSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(
      createGroupExpenseRequestSchema.safeParse({
        ...valid,
        split: { mode: 'equal', memberIds: [A], extra: 1 },
      }).success,
    ).toBe(false);
    expect(
      createGroupExpenseRequestSchema.safeParse({
        ...valid,
        payerAccount: { accountId: B, categoryId: C, extra: 1 },
      }).success,
    ).toBe(false);
  });

  it('rejects a duplicated member in every mode (AC-02)', () => {
    expect(splitSchema.safeParse({ mode: 'equal', memberIds: [A, A] }).success).toBe(false);
    expect(
      splitSchema.safeParse({
        mode: 'percentage',
        shares: [
          { memberId: A, basisPoints: 5000 },
          { memberId: A, basisPoints: 5000 },
        ],
      }).success,
    ).toBe(false);
    expect(
      splitSchema.safeParse({
        mode: 'exact',
        shares: [
          { memberId: A, amount: '1' },
          { memberId: A, amount: '1' },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires at least one share and rejects out-of-range basis points', () => {
    expect(splitSchema.safeParse({ mode: 'equal', memberIds: [] }).success).toBe(false);
    expect(splitSchema.safeParse({ mode: 'percentage', shares: [] }).success).toBe(false);
    expect(splitSchema.safeParse({ mode: 'exact', shares: [] }).success).toBe(false);
    for (const basisPoints of [-1, 10_001, 1.5]) {
      expect(
        splitSchema.safeParse({ mode: 'percentage', shares: [{ memberId: A, basisPoints }] })
          .success,
      ).toBe(false);
    }
  });

  it('rejects a negative exact amount and an unknown mode', () => {
    expect(
      splitSchema.safeParse({ mode: 'exact', shares: [{ memberId: A, amount: '-1' }] }).success,
    ).toBe(false);
    expect(splitSchema.safeParse({ mode: 'weights', memberIds: [A] }).success).toBe(false);
  });

  it('bounds a split to 50 members', () => {
    const many = Array.from(
      { length: 51 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(splitSchema.safeParse({ mode: 'equal', memberIds: many }).success).toBe(false);
    expect(splitSchema.safeParse({ mode: 'equal', memberIds: many.slice(0, 50) }).success).toBe(
      true,
    );
  });

  it('bounds the description to 1..200 characters, trimmed, without control characters', () => {
    const parse = (description: string) =>
      createGroupExpenseRequestSchema.safeParse({ ...valid, description });
    expect(parse('').success).toBe(false);
    expect(parse('   ').success).toBe(false);
    expect(parse('a'.repeat(201)).success).toBe(false);
    expect(parse('a'.repeat(200)).success).toBe(true);
    expect(parse('bad\u0000text').success).toBe(false);
    const trimmed = parse('  Dinner  ');
    expect(trimmed.success && trimmed.data.description).toBe('Dinner');
  });

  it('rejects an unknown currency and a non-UUID member', () => {
    expect(createGroupExpenseRequestSchema.safeParse({ ...valid, currency: 'EUR' }).success).toBe(
      false,
    );
    expect(
      createGroupExpenseRequestSchema.safeParse({ ...valid, payerMemberId: 'x' }).success,
    ).toBe(false);
  });
});

describe('defaultSplitRequestSchema', () => {
  it('accepts equal and percentage and rejects exact', () => {
    expect(defaultSplitRequestSchema.safeParse({ mode: 'equal' }).success).toBe(true);
    expect(
      defaultSplitRequestSchema.safeParse({
        mode: 'percentage',
        shares: [{ memberId: A, basisPoints: 10_000 }],
      }).success,
    ).toBe(true);
    expect(
      defaultSplitRequestSchema.safeParse({
        mode: 'exact',
        shares: [{ memberId: A, amount: '1' }],
      }).success,
    ).toBe(false);
  });
});

describe('query schemas', () => {
  it('coerces and bounds the list limit', () => {
    expect(listGroupExpensesQuerySchema.parse({}).limit).toBeUndefined();
    expect(listGroupExpensesQuerySchema.parse({ limit: '100' }).limit).toBe(100);
    expect(listGroupExpensesQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(listGroupExpensesQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listGroupExpensesQuerySchema.safeParse({ extra: '1' }).success).toBe(false);
  });

  it('accepts from, to and cursor on the personal shares query', () => {
    expect(
      personalSharesQuerySchema.safeParse({ from: NOW, to: NOW, limit: '10', cursor: 'abc' })
        .success,
    ).toBe(true);
    expect(personalSharesQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
  });
});

describe('response schemas', () => {
  const expense = {
    id: A,
    groupId: B,
    payerMemberId: A,
    createdByMemberId: A,
    amount: '10000',
    currency: 'ARS',
    occurredAt: NOW,
    categoryId: C,
    description: 'Dinner',
    splitMode: 'equal',
    payerMovementId: null,
    createdAt: NOW,
    shares: [
      { memberId: A, amount: '5000' },
      { memberId: B, amount: '5000' },
    ],
  };

  it('parses an expense, a page and the options', () => {
    expect(groupExpenseResponseSchema.safeParse(expense).success).toBe(true);
    expect(groupExpensePageSchema.safeParse({ items: [expense], nextCursor: null }).success).toBe(
      true,
    );
    expect(
      expenseOptionsResponseSchema.safeParse({
        members: [{ id: A, displayName: 'Ana', isGhost: false, joinedAt: NOW }],
        categories: [],
        defaultSplit: { mode: 'equal' },
        defaultRateType: 'blue',
      }).success,
    ).toBe(true);
  });

  it('parses the personal shares page with and without a receivable', () => {
    const item = {
      expenseId: A,
      groupId: B,
      currency: 'USD',
      occurredAt: NOW,
      shareAmount: '100',
      receivableAmount: null,
    };
    expect(personalSharesPageSchema.safeParse({ items: [item], nextCursor: null }).success).toBe(
      true,
    );
    expect(
      personalSharesPageSchema.safeParse({
        items: [{ ...item, receivableAmount: '50' }],
        nextCursor: 'c',
      }).success,
    ).toBe(true);
  });
});
