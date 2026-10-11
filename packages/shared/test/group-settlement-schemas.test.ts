import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/errors';
import {
  balancesResponseSchema,
  consolidationPreviewSchema,
  consolidationQuerySchema,
  createSettlementRequestSchema,
  listSettlementsQuerySchema,
  settlementPageSchema,
  settlementResponseSchema,
} from '../src/groups/settlement';
import { groupDetailResponseSchema } from '../src/groups/group';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ACC = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-10-10T12:00:00.000Z';

const single = {
  kind: 'single',
  fromMemberId: A,
  toMemberId: B,
  currency: 'ARS',
  amount: '10000',
  occurredAt: NOW,
};

const consolidated = {
  kind: 'consolidated',
  memberIds: [A, B],
  currency: 'USD',
  occurredAt: NOW,
  legs: { ARS: '-500000', USD: '2000' },
};

const ok = (input: unknown) => createSettlementRequestSchema.safeParse(input).success;

describe('settlement error codes', () => {
  it('declares the six codes', () => {
    for (const code of [
      'GROUP_SETTLEMENT_MEMBER_INVALID',
      'GROUP_SETTLEMENT_ACCOUNT_INVALID',
      'GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE',
      'GROUP_MEMBER_HAS_BALANCE',
      'GROUP_LAST_ADMIN',
      'GROUP_SETTLEMENT_STALE',
    ]) {
      expect(ERROR_CODES as readonly string[]).toContain(code);
    }
  });
});

describe('createSettlementRequestSchema (AC-06)', () => {
  it('accepts a single settlement with and without an account', () => {
    expect(ok(single)).toBe(true);
    expect(ok({ ...single, accountId: ACC })).toBe(true);
  });

  it('rejects an amount of 0, a negative amount and a non-integer amount', () => {
    for (const amount of ['0', '-100', '10.5', '', '01']) {
      expect(ok({ ...single, amount })).toBe(false);
    }
  });

  it('rejects an extra key, a missing kind and an unknown kind', () => {
    expect(ok({ ...single, extra: 1 })).toBe(false);
    const withoutKind: Record<string, unknown> = { ...single };
    delete withoutKind.kind;
    expect(ok(withoutKind)).toBe(false);
    expect(ok({ ...single, kind: 'other' })).toBe(false);
  });

  it('rejects the same member on both sides', () => {
    expect(ok({ ...single, toMemberId: A })).toBe(false);
  });

  it('rejects a currency other than ARS and USD and a non-uuid member', () => {
    expect(ok({ ...single, currency: 'EUR' })).toBe(false);
    expect(ok({ ...single, fromMemberId: 'nope' })).toBe(false);
  });

  it('accepts a consolidated settlement and rejects an extra key on it', () => {
    expect(ok(consolidated)).toBe(true);
    expect(ok({ ...consolidated, accountId: ACC })).toBe(true);
    expect(ok({ ...consolidated, extra: true })).toBe(false);
    expect(ok({ ...consolidated, legs: { ...consolidated.legs, EUR: '1' } })).toBe(false);
  });

  it('rejects a consolidated settlement with the same member twice or not two members', () => {
    expect(ok({ ...consolidated, memberIds: [A, A] })).toBe(false);
    expect(ok({ ...consolidated, memberIds: [A] })).toBe(false);
    expect(ok({ ...consolidated, memberIds: [A, B, ACC] })).toBe(false);
  });

  it('rejects a zero, non-integer or missing leg', () => {
    expect(ok({ ...consolidated, legs: { ARS: '0', USD: '2000' } })).toBe(false);
    expect(ok({ ...consolidated, legs: { ARS: '-500000', USD: '0' } })).toBe(false);
    expect(ok({ ...consolidated, legs: { ARS: '1.5', USD: '2000' } })).toBe(false);
    expect(ok({ ...consolidated, legs: { ARS: '-500000' } })).toBe(false);
  });

  it('rejects a leg outside the signed 64-bit range', () => {
    expect(ok({ ...consolidated, legs: { ARS: '9223372036854775808', USD: '1' } })).toBe(false);
    expect(ok({ ...consolidated, legs: { ARS: '9223372036854775807', USD: '-1' } })).toBe(true);
  });
});

describe('manual rate (AC-12, AC-13)', () => {
  it('accepts a positive integer rate scaled by 10,000', () => {
    expect(ok({ ...consolidated, rate: '10000000' })).toBe(true);
    expect(ok({ ...consolidated, rate: '1' })).toBe(true);
  });

  it('rejects a rate of 0, a negative rate and a decimal rate', () => {
    for (const rate of ['0', '-10000', '1000.5', '', '010']) {
      expect(ok({ ...consolidated, rate })).toBe(false);
    }
  });

  it('does not take a rate on a single settlement', () => {
    expect(ok({ ...single, rate: '10000000' })).toBe(false);
  });
});

describe('consolidation, balances and settlement reading', () => {
  it('accepts the consolidation query and rejects the same member twice', () => {
    const query = { memberA: A, memberB: B, currency: 'ARS' };
    expect(consolidationQuerySchema.safeParse(query).success).toBe(true);
    expect(consolidationQuerySchema.safeParse({ ...query, memberB: A }).success).toBe(false);
    expect(consolidationQuerySchema.safeParse({ ...query, x: 1 }).success).toBe(false);
  });

  it('accepts a preview with and without a stored rate', () => {
    const base = { legs: { ARS: '-500000', USD: '2000' }, defaultRateType: 'blue' };
    expect(consolidationPreviewSchema.safeParse({ ...base, rate: '10000000' }).success).toBe(true);
    expect(consolidationPreviewSchema.safeParse({ ...base, rate: null }).success).toBe(true);
    expect(consolidationPreviewSchema.safeParse(base).success).toBe(false);
  });

  it('accepts a balances response with signed balances and payments', () => {
    const currency = {
      members: [
        { memberId: A, balance: '-10000' },
        { memberId: B, balance: '10000' },
      ],
      payments: [{ fromMemberId: A, toMemberId: B, amount: '10000' }],
    };
    const empty = { members: [], payments: [] };
    expect(balancesResponseSchema.safeParse({ ARS: currency, USD: empty }).success).toBe(true);
    expect(balancesResponseSchema.safeParse({ ARS: currency }).success).toBe(false);
  });

  const settlement = {
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
  };

  it('accepts a settlement response and a page of them', () => {
    expect(settlementResponseSchema.safeParse(settlement).success).toBe(true);
    expect(
      settlementResponseSchema.safeParse({
        ...settlement,
        amount: '0',
        rate: '10000000',
        rateSource: 'automatic',
        rateType: 'blue',
      }).success,
    ).toBe(true);
    expect(settlementPageSchema.safeParse({ items: [settlement], nextCursor: null }).success).toBe(
      true,
    );
  });

  it('bounds the list query: limit 1 to 100 and a cursor', () => {
    expect(listSettlementsQuerySchema.safeParse({}).success).toBe(true);
    expect(listSettlementsQuerySchema.safeParse({ limit: '100', cursor: 'abc' }).success).toBe(
      true,
    );
    expect(listSettlementsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(listSettlementsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(listSettlementsQuerySchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});

describe('group detail formerMembers (AC-20)', () => {
  const group = {
    id: A,
    name: 'Casa',
    defaultRateType: 'blue',
    role: 'admin',
    memberCount: 1,
    createdAt: NOW,
    members: [],
  };

  it('requires formerMembers and accepts id, displayName and leftAt', () => {
    expect(groupDetailResponseSchema.safeParse(group).success).toBe(false);
    expect(
      groupDetailResponseSchema.safeParse({
        ...group,
        formerMembers: [{ id: B, displayName: null, leftAt: NOW }],
      }).success,
    ).toBe(true);
    expect(groupDetailResponseSchema.safeParse({ ...group, formerMembers: [] }).success).toBe(true);
  });
});
