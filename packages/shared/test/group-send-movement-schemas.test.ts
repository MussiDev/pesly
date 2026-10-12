import { describe, expect, it } from 'vitest';
import {
  AUTOMATIC_SEND_CATEGORY_KEY,
  DEFAULT_CATEGORIES,
  ERROR_CODES,
  automaticCategoryChangeSchema,
  listMovementsResponseSchema,
  movementDetailResponseSchema,
  sendMovementToGroupRequestSchema,
  sendMovementToGroupResponseSchema,
} from '../src';

const MOVEMENT = '11111111-1111-4111-8111-111111111111';
const CAT = '33333333-3333-4333-8333-333333333333';
const GROUP = '44444444-4444-4444-8444-444444444444';
const EXPENSE = '55555555-5555-4555-8555-555555555555';
const M1 = '66666666-6666-4666-8666-666666666666';
const M2 = '77777777-7777-4777-8777-777777777777';
const NOW = '2026-10-10T12:00:00.000Z';

const body = {
  movementId: MOVEMENT,
  categoryId: CAT,
  description: 'Dinner',
  split: { mode: 'equal', memberIds: [M1, M2] },
};

const okRequest = (input: unknown) => sendMovementToGroupRequestSchema.safeParse(input).success;

const expenseResponse = {
  id: EXPENSE,
  groupId: GROUP,
  payerMemberId: M1,
  createdByMemberId: M1,
  amount: '30000',
  currency: 'ARS',
  occurredAt: NOW,
  categoryId: CAT,
  description: 'Dinner',
  splitMode: 'equal',
  payerMovementId: MOVEMENT,
  createdAt: NOW,
  shares: [{ memberId: M1, amount: '30000' }],
  version: 1,
};

const movement = {
  id: MOVEMENT,
  type: 'expense',
  accountId: M1,
  categoryId: null,
  destinationAccountId: null,
  amount: '30000',
  destinationAmount: null,
  occurredAt: NOW,
  note: null,
  rate: null,
  rateSource: null,
  rateType: null,
  createdAt: NOW,
  tags: [],
};

const link = { groupId: GROUP, expenseId: EXPENSE, adopted: false };

/** A copy of `value` without `key`, for asserting what a schema or a read does without a field. */
function omit<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  Reflect.deleteProperty(copy, key);
  return copy;
}

describe('sendMovementToGroupRequestSchema', () => {
  it('accepts a body with and without description and categoryId', () => {
    expect(okRequest(body)).toBe(true);
    const noDescription = omit(body, 'description');
    expect(okRequest(noDescription)).toBe(true);
    const noCategory = omit(body, 'categoryId');
    expect(okRequest(noCategory)).toBe(true);
  });

  it.each([
    'amount',
    'currency',
    'payerAccount',
    'categoryName',
    'categoryKey',
    'name',
    'icon',
    'color',
  ])('rejects the unknown key %s', (key) => {
    expect(okRequest({ ...body, [key]: 'x' })).toBe(false);
  });

  it('rejects a categoryId or movementId that is not a uuid', () => {
    expect(okRequest({ ...body, categoryId: 'nope' })).toBe(false);
    expect(okRequest({ ...body, movementId: 'nope' })).toBe(false);
  });

  it('rejects an empty or 201-character description', () => {
    expect(okRequest({ ...body, description: '' })).toBe(false);
    expect(okRequest({ ...body, description: 'a'.repeat(201) })).toBe(false);
    expect(okRequest({ ...body, description: 'a'.repeat(200) })).toBe(true);
  });

  it('rejects a split with a duplicate member and a missing split', () => {
    expect(okRequest({ ...body, split: { mode: 'equal', memberIds: [M1, M1] } })).toBe(false);
    const noSplit = omit(body, 'split');
    expect(okRequest(noSplit)).toBe(false);
  });
});

describe('sendMovementToGroupResponseSchema', () => {
  it.each(['created', 'restored', null])('accepts autoCategory %s', (autoCategory) => {
    expect(
      sendMovementToGroupResponseSchema.safeParse({ ...expenseResponse, autoCategory }).success,
    ).toBe(true);
  });

  it('rejects another value or a missing field', () => {
    expect(
      sendMovementToGroupResponseSchema.safeParse({ ...expenseResponse, autoCategory: 'other' })
        .success,
    ).toBe(false);
    expect(sendMovementToGroupResponseSchema.safeParse(expenseResponse).success).toBe(false);
    expect(automaticCategoryChangeSchema.safeParse('created').success).toBe(true);
  });
});

describe('AUTOMATIC_SEND_CATEGORY_KEY', () => {
  it('is the key of a top-level expense default category', () => {
    const found = DEFAULT_CATEGORIES.find((c) => c.key === AUTOMATIC_SEND_CATEGORY_KEY);
    expect(found?.kind).toBe('expense');
    expect(found?.parentKey).toBeNull();
  });
});

describe('movement detail and list contracts', () => {
  it('detail accepts a null link and an adopted link, rejects a numeric id', () => {
    const ok = (groupExpense: unknown) =>
      movementDetailResponseSchema.safeParse({ ...movement, groupExpense }).success;
    expect(ok(null)).toBe(true);
    expect(ok({ ...link, adopted: true })).toBe(true);
    expect(ok({ ...link, groupId: 5 })).toBe(false);
    expect(movementDetailResponseSchema.safeParse(movement).success).toBe(false);
  });

  it('list accepts empty and uuid-keyed groupLinks, rejects bad keys and missing groupId', () => {
    const ok = (groupLinks: unknown) =>
      listMovementsResponseSchema.safeParse({
        items: [movement],
        total: 1,
        limit: 20,
        offset: 0,
        groupLinks,
      }).success;
    expect(ok({})).toBe(true);
    expect(ok({ [MOVEMENT]: link })).toBe(true);
    expect(ok({ 'not-a-uuid': link })).toBe(false);
    expect(ok({ [MOVEMENT]: { expenseId: EXPENSE, adopted: false } })).toBe(false);
    expect(ok({ [MOVEMENT]: { ...link, extra: 1 } })).toBe(false);
  });
});

describe('error codes', () => {
  it('include the group movement codes', () => {
    for (const code of [
      'GROUP_MOVEMENT_NOT_EXPENSE',
      'GROUP_MOVEMENT_ALREADY_SENT',
      'MOVEMENT_LOCKED_BY_GROUP_EXPENSE',
      'GROUP_MOVEMENT_CHANGED',
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });
});
