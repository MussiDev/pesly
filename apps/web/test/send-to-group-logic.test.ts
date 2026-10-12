import { sendMovementToGroupRequestSchema, type MovementResponse } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { canOfferSendToGroup } from '../src/features/movements/send-to-group/eligibility';
import {
  AUTOMATIC_CATEGORY,
  defaultSendSplit,
  pickOnlyGroup,
} from '../src/features/movements/send-to-group/send-defaults';
import {
  buildSendRequest,
  descriptionFromNote,
  type SendRequestContext,
} from '../src/features/movements/send-to-group/send-request';

const ME = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';
const MOVEMENT_ID = '55555555-5555-4555-8555-555555555555';
const CATEGORY = '66666666-6666-4666-8666-666666666666';
const LINK = {
  groupId: '77777777-7777-4777-8777-777777777777',
  expenseId: '88888888-8888-4888-8888-888888888888',
  adopted: true,
};

const options = {
  selfMemberId: ME,
  members: [{ id: ME }, { id: B }, { id: C }, { id: D }],
  categories: [{ id: CATEGORY, archivedAt: null }],
  defaultSplit: {
    mode: 'percentage' as const,
    shares: [
      { memberId: ME, basisPoints: 7000 },
      { memberId: B, basisPoints: 3000 },
    ],
  },
};

function movement(overrides: Partial<MovementResponse> = {}): MovementResponse {
  return {
    id: MOVEMENT_ID,
    type: 'expense',
    accountId: '99999999-9999-4999-8999-999999999999',
    categoryId: null,
    destinationAccountId: null,
    amount: '4000000',
    destinationAmount: null,
    occurredAt: '2026-10-10T12:00:00.000Z',
    note: 'Dinner',
    rate: null,
    rateSource: null,
    rateType: null,
    createdAt: '2026-10-10T12:00:00.000Z',
    tags: [],
    ...overrides,
  };
}

const offer = { movement: movement(), groupExpense: null, queued: false, online: true };

function context(overrides: Partial<SendRequestContext> = {}): SendRequestContext {
  return {
    movementId: MOVEMENT_ID,
    amount: 4000000n,
    memberIds: options.members.map((m) => m.id),
    categories: options.categories,
    locale: 'en',
    ...overrides,
  };
}

function values(overrides: Partial<Parameters<typeof buildSendRequest>[0]> = {}) {
  return {
    description: 'Dinner',
    category: AUTOMATIC_CATEGORY,
    split: defaultSendSplit(options),
    ...overrides,
  };
}

describe('canOfferSendToGroup', () => {
  it('is offered for an online, server-held, unlinked expense', () => {
    expect(canOfferSendToGroup(offer)).toBe(true);
  });

  it.each([
    ['offline', { ...offer, online: false }],
    ['income', { ...offer, movement: movement({ type: 'income' }) }],
    ['transfer', { ...offer, movement: movement({ type: 'transfer' }) }],
    ['exchange', { ...offer, movement: movement({ type: 'exchange' }) }],
    ['queued', { ...offer, queued: true }],
    ['device copy', { ...offer, deviceCopy: true }],
    ['linked', { ...offer, groupExpense: LINK }],
  ])('is not offered when %s', (_name, input) => {
    expect(canOfferSendToGroup(input)).toBe(false);
  });
});

describe('pickOnlyGroup', () => {
  it('returns the id for exactly one group', () => {
    expect(pickOnlyGroup([{ id: 'g1' }])).toBe('g1');
  });
  it('returns undefined for none and for two or more', () => {
    expect(pickOnlyGroup([])).toBeUndefined();
    expect(pickOnlyGroup([{ id: 'g1' }, { id: 'g2' }])).toBeUndefined();
  });
});

describe('defaults', () => {
  it('keeps the category automatic even without an other-expenses category', () => {
    const result = buildSendRequest(values(), context({ categories: [] }));
    expect(result.request).toBeDefined();
    expect(result.request).not.toHaveProperty('categoryId');
  });

  it('sends a category the person picked by id', () => {
    const result = buildSendRequest(values({ category: CATEGORY }), context());
    expect(result.request?.categoryId).toBe(CATEGORY);
  });

  it('rejects a category that is not among the active options', () => {
    const result = buildSendRequest(
      values({ category: CATEGORY }),
      context({
        categories: [{ id: CATEGORY, archivedAt: '2026-01-01T00:00:00.000Z' }],
      }),
    );
    expect(result.request).toBeUndefined();
    expect(result.fields?.category).toBeDefined();
  });

  it('starts equal with every member checked even when the group default is percentage', () => {
    const split = defaultSendSplit(options);
    expect(split.mode).toBe('equal');
    expect(split.selectedMemberIds).toEqual([ME, B, C, D]);
    const result = buildSendRequest(values({ split }), context({ amount: 4000000n }));
    expect(result.request?.split).toEqual({ mode: 'equal', memberIds: [ME, B, C, D] });
  });

  it('default values alone build a valid body with no amount, currency, date or payer', () => {
    const result = buildSendRequest(values(), context());
    expect(result.request).toEqual({
      movementId: MOVEMENT_ID,
      description: 'Dinner',
      split: { mode: 'equal', memberIds: [ME, B, C, D] },
    });
    expect(sendMovementToGroupRequestSchema.safeParse(result.request).success).toBe(true);
  });
});

describe('descriptionFromNote', () => {
  it('collapses whitespace and cuts to 200 code points', () => {
    const note = `${'ab\n\n  '.repeat(60)}${'😀'.repeat(300)}`;
    const text = descriptionFromNote(note);
    expect(Array.from(text).length).toBeLessThanOrEqual(200);
    expect(text).not.toMatch(/\s{2}|\n/);
    expect(text.startsWith('ab ab')).toBe(true);
  });
  it('is empty for a missing note', () => {
    expect(descriptionFromNote(null)).toBe('');
  });
});

describe('buildSendRequest errors', () => {
  it('an empty description is a field error and builds no request', () => {
    const result = buildSendRequest(values({ description: '   ' }), context());
    expect(result.request).toBeUndefined();
    expect(result.fields?.description).toBeDefined();
  });

  it('percentages totalling 99 are a field error', () => {
    const split = {
      ...defaultSendSplit(options),
      mode: 'percentage' as const,
      values: { [ME]: '33', [B]: '33', [C]: '33' },
    };
    const result = buildSendRequest(values({ split }), context());
    expect(result.request).toBeUndefined();
    expect(result.fields?.split).toBeDefined();
  });

  it('exact amounts that differ from the movement amount are a field error', () => {
    const split = {
      ...defaultSendSplit(options),
      mode: 'exact' as const,
      values: { [ME]: '100.00', [B]: '200.00' },
    };
    const result = buildSendRequest(values({ split }), context());
    expect(result.request).toBeUndefined();
    expect(result.fields?.split).toBeDefined();
  });

  it('splits 40,000.00 ARS into 4 shares of 10,000.00', () => {
    const split = {
      ...defaultSendSplit(options),
      mode: 'exact' as const,
      values: { [ME]: '10,000.00', [B]: '10,000.00', [C]: '10,000.00', [D]: '10,000.00' },
    };
    const result = buildSendRequest(values({ split }), context());
    expect(result.request?.split).toEqual({
      mode: 'exact',
      shares: [ME, B, C, D].map((memberId) => ({ memberId, amount: '1000000' })),
    });
  });
});
