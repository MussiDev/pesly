import type { GroupExpenseResponse, SettlementResponse } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { isRequestApplied } from '../src/lib/sync/group-request-applied';

const A = '00000000-0000-4000-8000-000000000201';
const B = '00000000-0000-4000-8000-000000000202';
const C = '00000000-0000-4000-8000-000000000203';
const CATEGORY = '00000000-0000-4000-8000-000000000301';

function expense(over: Partial<GroupExpenseResponse> = {}): GroupExpenseResponse {
  return {
    id: 'e',
    groupId: 'g',
    payerMemberId: A,
    createdByMemberId: A,
    amount: '10000',
    currency: 'ARS',
    occurredAt: '2026-10-02T15:30:00.000Z',
    categoryId: CATEGORY,
    description: 'dinner',
    splitMode: 'equal',
    payerMovementId: null,
    createdAt: '2026-10-02T15:31:00.000Z',
    shares: [
      { memberId: A, amount: '5000' },
      { memberId: B, amount: '5000' },
    ],
    version: 3,
    ...over,
  };
}

const request = (over: object = {}) => ({
  amount: '10000',
  occurredAt: '2026-10-02T15:30:00.000Z',
  categoryId: CATEGORY,
  description: 'dinner',
  split: { mode: 'equal' as const, memberIds: [B, A] },
  ...over,
});

describe('isRequestApplied (expense)', () => {
  it('is true for equal fields and an equal split in another order', () => {
    expect(isRequestApplied('expense', request(), expense())).toBe(true);
  });

  it.each([
    ['amount', { amount: '10001' }],
    ['occurredAt', { occurredAt: '2026-10-02T15:31:00.000Z' }],
    ['categoryId', { categoryId: C }],
    ['description', { description: 'lunch' }],
  ])('is false when %s differs', (_name, over) => {
    expect(isRequestApplied('expense', request(over), expense())).toBe(false);
  });

  it('is false when the equal members differ or the mode differs', () => {
    expect(
      isRequestApplied('expense', request({ split: { mode: 'equal', memberIds: [A] } }), expense()),
    ).toBe(false);
    expect(isRequestApplied('expense', request(), expense({ splitMode: 'exact' }))).toBe(false);
  });

  it('compares exact shares by member and amount, in any order', () => {
    const server = expense({
      splitMode: 'exact',
      shares: [
        { memberId: A, amount: '7000' },
        { memberId: B, amount: '3000' },
      ],
    });
    const mine = (shares: { memberId: string; amount: string }[]) =>
      request({ split: { mode: 'exact', shares } });

    expect(
      isRequestApplied(
        'expense',
        mine([
          { memberId: B, amount: '3000' },
          { memberId: A, amount: '7000' },
        ]),
        server,
      ),
    ).toBe(true);
    expect(
      isRequestApplied(
        'expense',
        mine([
          { memberId: A, amount: '6000' },
          { memberId: B, amount: '4000' },
        ]),
        server,
      ),
    ).toBe(false);
  });

  it('never treats a percentage split as applied: the response does not expose basis points', () => {
    const server = expense({ splitMode: 'percentage' });
    const mine = request({
      split: {
        mode: 'percentage',
        shares: [
          { memberId: A, basisPoints: 5000 },
          { memberId: B, basisPoints: 5000 },
        ],
      },
    });

    expect(isRequestApplied('expense', mine, server)).toBe(false);
  });

  it('is false when the server record is of the other kind', () => {
    expect(isRequestApplied('settlement', { amount: '10000' }, expense())).toBe(false);
  });
});

describe('isRequestApplied (settlement)', () => {
  const settlement = (amount = '2500'): SettlementResponse => ({
    id: 's',
    groupId: 'g',
    fromMemberId: A,
    toMemberId: B,
    currency: 'ARS',
    amount,
    legs: [{ currency: 'ARS', amount }],
    occurredAt: '2026-10-03T10:00:00.000Z',
    createdByMemberId: A,
    accountId: null,
    rate: null,
    rateSource: null,
    rateType: null,
    createdAt: '2026-10-03T10:01:00.000Z',
    version: 3,
  });

  it('compares only the fields the request carries', () => {
    expect(isRequestApplied('settlement', { amount: '2500' }, settlement())).toBe(true);
    expect(
      isRequestApplied(
        'settlement',
        { amount: '2500', occurredAt: '2026-10-03T10:00:00.000Z' },
        settlement(),
      ),
    ).toBe(true);
    expect(isRequestApplied('settlement', { amount: '2600' }, settlement())).toBe(false);
    expect(
      isRequestApplied('settlement', { occurredAt: '2026-10-04T10:00:00.000Z' }, settlement()),
    ).toBe(false);
  });
});
