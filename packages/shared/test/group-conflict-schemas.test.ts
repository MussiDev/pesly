import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/errors';
import {
  deleteGroupExpenseQuerySchema,
  groupExpenseResponseSchema,
  updateGroupExpenseRequestSchema,
} from '../src/groups/expense';
import { groupRecordConflictSchema } from '../src/groups/conflict';
import {
  deleteSettlementQuerySchema,
  settlementResponseSchema,
  updateSettlementRequestSchema,
} from '../src/groups/settlement';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CAT = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-10-10T12:00:00.000Z';

const expenseBody = {
  amount: '30000',
  occurredAt: NOW,
  categoryId: CAT,
  description: 'Dinner',
  split: { mode: 'equal', memberIds: [A, B] },
  baseVersion: 1,
};

const expenseRecord = {
  id: A,
  groupId: B,
  payerMemberId: A,
  createdByMemberId: A,
  amount: '10000',
  currency: 'ARS',
  occurredAt: NOW,
  categoryId: CAT,
  description: 'Dinner',
  splitMode: 'equal',
  payerMovementId: null,
  createdAt: NOW,
  shares: [{ memberId: A, amount: '10000' }],
  version: 2,
};

const settlementRecord = {
  id: A,
  groupId: B,
  fromMemberId: A,
  toMemberId: B,
  currency: 'ARS',
  amount: '10000',
  legs: [{ currency: 'ARS', amount: '10000' }],
  occurredAt: NOW,
  createdByMemberId: A,
  accountId: null,
  rate: null,
  rateSource: null,
  rateType: null,
  createdAt: NOW,
  version: 3,
};

const okExpense = (input: unknown) => updateGroupExpenseRequestSchema.safeParse(input).success;
const okSettlement = (input: unknown) => updateSettlementRequestSchema.safeParse(input).success;

describe('GROUP_RECORD_CONFLICT code', () => {
  it('is declared', () => {
    expect(ERROR_CODES as readonly string[]).toContain('GROUP_RECORD_CONFLICT');
  });
});

describe('baseVersion on the update requests (AC-01)', () => {
  it('accepts baseVersion 1 and the maximum on the expense update', () => {
    expect(okExpense(expenseBody)).toBe(true);
    expect(okExpense({ ...expenseBody, baseVersion: 2147483647 })).toBe(true);
  });

  it('rejects a missing baseVersion on the expense update', () => {
    const rest = Object.fromEntries(
      Object.entries(expenseBody).filter(([key]) => key !== 'baseVersion'),
    );
    expect(okExpense(rest)).toBe(false);
  });

  it('rejects 0, 1.5, negative, too large and non-numeric baseVersion on the expense update', () => {
    for (const baseVersion of [0, 1.5, -1, 2147483648, '1', null]) {
      expect(okExpense({ ...expenseBody, baseVersion })).toBe(false);
    }
  });

  it('accepts baseVersion on the settlement patch and requires it', () => {
    expect(okSettlement({ amount: '5000', baseVersion: 1 })).toBe(true);
    expect(okSettlement({ occurredAt: NOW, baseVersion: 4 })).toBe(true);
    expect(okSettlement({ amount: '5000' })).toBe(false);
    expect(okSettlement({ baseVersion: 1 })).toBe(false);
  });

  it('rejects 0, 1.5 and negative baseVersion on the settlement patch', () => {
    for (const baseVersion of [0, 1.5, -2, 2147483648, 'x']) {
      expect(okSettlement({ amount: '5000', baseVersion })).toBe(false);
    }
  });
});

describe('delete queries', () => {
  it('coerce a numeric baseVersion string to an integer', () => {
    expect(deleteGroupExpenseQuerySchema.parse({ baseVersion: '3' })).toEqual({ baseVersion: 3 });
    expect(deleteSettlementQuerySchema.parse({ baseVersion: '1' })).toEqual({ baseVersion: 1 });
  });

  it('reject a missing, non-numeric, zero, fractional or unknown baseVersion', () => {
    for (const schema of [deleteGroupExpenseQuerySchema, deleteSettlementQuerySchema]) {
      expect(schema.safeParse({}).success).toBe(false);
      for (const baseVersion of ['abc', '', '0', '1.5', '-1', '2147483648', ' ']) {
        expect(schema.safeParse({ baseVersion }).success).toBe(false);
      }
      expect(schema.safeParse({ baseVersion: '1', extra: 'x' }).success).toBe(false);
    }
  });
});

describe('version on the responses', () => {
  it('requires a positive integer version on expense and settlement responses', () => {
    expect(groupExpenseResponseSchema.safeParse(expenseRecord).success).toBe(true);
    expect(settlementResponseSchema.safeParse(settlementRecord).success).toBe(true);
    const withoutVersion = (record: object) =>
      Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'version'));
    const expenseNoVersion = withoutVersion(expenseRecord);
    const settlementNoVersion = withoutVersion(settlementRecord);
    expect(groupExpenseResponseSchema.safeParse(expenseNoVersion).success).toBe(false);
    expect(settlementResponseSchema.safeParse(settlementNoVersion).success).toBe(false);
    expect(groupExpenseResponseSchema.safeParse({ ...expenseRecord, version: 0 }).success).toBe(
      false,
    );
    expect(settlementResponseSchema.safeParse({ ...settlementRecord, version: 1.5 }).success).toBe(
      false,
    );
  });
});

describe('groupRecordConflictSchema', () => {
  it('parses an expense and a settlement as current', () => {
    expect(groupRecordConflictSchema.safeParse({ current: expenseRecord }).success).toBe(true);
    expect(groupRecordConflictSchema.safeParse({ current: settlementRecord }).success).toBe(true);
  });

  it('rejects a missing or malformed current', () => {
    expect(groupRecordConflictSchema.safeParse({}).success).toBe(false);
    expect(groupRecordConflictSchema.safeParse({ current: { id: A } }).success).toBe(false);
  });
});
