import { describe, expect, it } from 'vitest';
import type { BalancesResponse, ConsolidationPreview, GroupDetailResponse } from '@pesly/shared';
import { buildBalanceView } from '../src/features/groups/settlements/balance-view';
import {
  buildConsolidationRequest,
  cashOf,
} from '../src/features/groups/settlements/consolidation-request';
import {
  amountToInput,
  buildSettlementRequest,
  prefillSettlement,
  type SettlementFormValues,
  type SettlementRequestContext,
} from '../src/features/groups/settlements/settlement-request';

const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';
const CARLA = '33333333-3333-4333-8333-333333333333';
const LUIS = '44444444-4444-4444-8444-444444444444';
const ACCOUNT = '99999999-9999-4999-8999-999999999999';

const NOW = new Date('2026-10-11T15:30:00.000Z');
const TZ = 'America/Argentina/Buenos_Aires';

const group = (overrides: Partial<GroupDetailResponse> = {}): GroupDetailResponse => ({
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Flatmates',
  defaultRateType: 'blue',
  role: 'member',
  memberCount: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  selfMemberId: BRUNO,
  members: [
    {
      id: ANA,
      displayName: 'Ana',
      isGhost: false,
      role: 'admin',
      joinedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: BRUNO,
      displayName: 'Bruno',
      isGhost: false,
      role: 'member',
      joinedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: CARLA,
      displayName: null,
      isGhost: true,
      role: 'member',
      joinedAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  formerMembers: [{ id: LUIS, displayName: 'Luis', leftAt: '2026-10-05T00:00:00.000Z' }],
  ...overrides,
});

const balances = (overrides: Partial<BalancesResponse> = {}): BalancesResponse => ({
  ARS: {
    members: [
      { memberId: ANA, balance: '30000' },
      { memberId: BRUNO, balance: '-20000' },
      { memberId: CARLA, balance: '-10000' },
    ],
    payments: [
      { fromMemberId: BRUNO, toMemberId: ANA, amount: '20000' },
      { fromMemberId: CARLA, toMemberId: ANA, amount: '10000' },
    ],
  },
  USD: {
    members: [
      { memberId: ANA, balance: '-500' },
      { memberId: BRUNO, balance: '500' },
      { memberId: CARLA, balance: '0' },
    ],
    payments: [{ fromMemberId: ANA, toMemberId: BRUNO, amount: '500' }],
  },
  ...overrides,
});

describe('buildBalanceView', () => {
  it('marks a negative balance as owes and a positive one as owed, per currency', () => {
    const view = buildBalanceView(balances(), group(), BRUNO);
    const [ars, usd] = view;
    expect(ars?.currency).toBe('ARS');
    expect(usd?.currency).toBe('USD');
    const status = (currency: typeof ars, id: string) =>
      currency?.rows.find((row) => row.memberId === id);
    expect(status(ars, ANA)).toMatchObject({ balance: 30000n, status: 'owed' });
    expect(status(ars, BRUNO)).toMatchObject({ balance: -20000n, status: 'owes' });
    expect(status(usd, ANA)).toMatchObject({ balance: -500n, status: 'owes' });
    expect(status(usd, BRUNO)).toMatchObject({ balance: 500n, status: 'owed' });
    expect(status(usd, CARLA)).toMatchObject({ balance: 0n, status: 'even' });
  });

  it('puts the caller first in each currency and keeps the API order for the rest', () => {
    const view = buildBalanceView(balances(), group(), BRUNO);
    expect(view[0]?.rows.map((row) => row.memberId)).toEqual([BRUNO, ANA, CARLA]);
    expect(view[1]?.rows.map((row) => row.memberId)).toEqual([BRUNO, ANA, CARLA]);
    expect(view[0]?.rows[0]?.isSelf).toBe(true);
    expect(view[0]?.rows[1]?.isSelf).toBe(false);
  });

  it('names members from members and formerMembers; an unnamed one has a null name', () => {
    const withFormer = balances({
      ARS: {
        members: [
          { memberId: ANA, balance: '100' },
          { memberId: CARLA, balance: '-50' },
          { memberId: LUIS, balance: '-50' },
        ],
        payments: [{ fromMemberId: LUIS, toMemberId: ANA, amount: '50' }],
      },
    });
    const [ars] = buildBalanceView(withFormer, group(), ANA);
    expect(ars?.rows.map((row) => row.name)).toEqual(['Ana', null, 'Luis']);
    expect(ars?.payments[0]).toEqual({
      fromMemberId: LUIS,
      toMemberId: ANA,
      fromName: 'Luis',
      toName: 'Ana',
      amount: 50n,
    });
  });

  it('marks a currency whose balances are all 0 as settled with no payments', () => {
    const zero = balances({
      USD: {
        members: [
          { memberId: ANA, balance: '0' },
          { memberId: BRUNO, balance: '0' },
        ],
        payments: [],
      },
    });
    const [ars, usd] = buildBalanceView(zero, group(), BRUNO);
    expect(ars?.settled).toBe(false);
    expect(usd?.settled).toBe(true);
    expect(usd?.payments).toEqual([]);
  });
});

const baseValues = (overrides: Partial<SettlementFormValues> = {}): SettlementFormValues => ({
  fromMemberId: BRUNO,
  toMemberId: ANA,
  currency: 'ARS',
  amount: '1.234,50',
  occurredAt: '2026-10-11T09:00',
  accountId: '',
  ...overrides,
});

const context = (overrides: Partial<SettlementRequestContext> = {}): SettlementRequestContext => ({
  memberIds: [ANA, BRUNO, CARLA],
  selfMemberId: BRUNO,
  accountIds: [ACCOUNT],
  timeZone: TZ,
  locale: 'es',
  now: NOW,
  ...overrides,
});

describe('prefillSettlement', () => {
  it('prefills members, currency, amount and today in the user time zone', () => {
    const values = prefillSettlement(
      { fromMemberId: BRUNO, toMemberId: ANA, amount: 123450n },
      'ARS',
      { locale: 'es', timeZone: TZ, now: NOW },
    );
    expect(values).toEqual({
      fromMemberId: BRUNO,
      toMemberId: ANA,
      currency: 'ARS',
      amount: '1234,50',
      occurredAt: '2026-10-11T12:30',
      accountId: '',
    });
  });

  it('uses the user time zone for the date, not UTC', () => {
    const late = new Date('2026-10-12T01:30:00.000Z');
    const values = prefillSettlement(null, 'USD', { locale: 'en', timeZone: TZ, now: late });
    expect(values.occurredAt).toBe('2026-10-11T22:30');
    expect(values).toMatchObject({ fromMemberId: '', toMemberId: '', amount: '', currency: 'USD' });
  });
});

describe('amountToInput', () => {
  it('writes minor units in the locale decimal notation without grouping', () => {
    expect(amountToInput(123450n, 'es')).toBe('1234,50');
    expect(amountToInput(123450n, 'en')).toBe('1234.50');
    expect(amountToInput(1200n, 'en')).toBe('12');
    expect(amountToInput(5n, 'en')).toBe('0.05');
  });
});

describe('buildSettlementRequest', () => {
  it('builds the single body with minor-units strings', () => {
    const result = buildSettlementRequest(baseValues(), context());
    expect(result.fields).toBeUndefined();
    expect(result.request).toEqual({
      kind: 'single',
      fromMemberId: BRUNO,
      toMemberId: ANA,
      currency: 'ARS',
      amount: '123450',
      occurredAt: '2026-10-11T12:00:00.000Z',
    });
  });

  it.each(['', '0', '-5', 'abc', '1,5,5'])('rejects the amount %j with a field error', (amount) => {
    const result = buildSettlementRequest(baseValues({ amount }), context());
    expect(result.request).toBeUndefined();
    expect(result.fields?.amount).toMatch(/^groups\.settlement\.errors\./);
  });

  it('rejects the same member on both sides', () => {
    const result = buildSettlementRequest(baseValues({ toMemberId: BRUNO }), context());
    expect(result.request).toBeUndefined();
    expect(result.fields?.toMember).toBe('groups.settlement.errors.sameMember');
  });

  it('rejects members that are not active members of the group', () => {
    const result = buildSettlementRequest(baseValues({ fromMemberId: LUIS }), context());
    expect(result.request).toBeUndefined();
    expect(result.fields?.fromMember).toBe('groups.settlement.errors.memberRequired');
  });

  it('rejects a currency that is not ARS or USD', () => {
    const result = buildSettlementRequest(baseValues({ currency: 'EUR' }), context());
    expect(result.fields?.currency).toBe('groups.settlement.errors.currencyInvalid');
  });

  it('sends the account only for a party who chose one', () => {
    const party = buildSettlementRequest(baseValues({ accountId: ACCOUNT }), context());
    expect(party.request).toMatchObject({ accountId: ACCOUNT });

    const none = buildSettlementRequest(baseValues({ accountId: '' }), context());
    expect(none.request).not.toHaveProperty('accountId');

    const payee = buildSettlementRequest(
      baseValues({ fromMemberId: ANA, toMemberId: BRUNO, accountId: ACCOUNT }),
      context(),
    );
    expect(payee.request).toMatchObject({ accountId: ACCOUNT });
  });

  it('never sends the account when the caller is not a party', () => {
    const result = buildSettlementRequest(
      baseValues({ fromMemberId: ANA, toMemberId: CARLA, accountId: ACCOUNT }),
      context(),
    );
    expect(result.fields).toBeUndefined();
    expect(result.request).not.toHaveProperty('accountId');
  });

  it('rejects an account that is not in the loaded list', () => {
    const result = buildSettlementRequest(
      baseValues({ accountId: '88888888-8888-4888-8888-888888888888' }),
      context(),
    );
    expect(result.request).toBeUndefined();
    expect(result.fields?.account).toBe('groups.settlement.errors.accountInvalid');
  });

  it('rejects a date in the future, a malformed date and a skipped local time', () => {
    const future = buildSettlementRequest(
      baseValues({ occurredAt: '2026-10-12T09:00' }),
      context(),
    );
    expect(future.fields?.occurredAt).toBe('groups.settlement.errors.dateInFuture');
    const malformed = buildSettlementRequest(baseValues({ occurredAt: 'yesterday' }), context());
    expect(malformed.fields?.occurredAt).toBe('groups.settlement.errors.dateInvalid');
    const skipped = buildSettlementRequest(
      baseValues({ occurredAt: '2026-03-08T02:30' }),
      context({ timeZone: 'America/New_York', now: new Date('2026-10-11T15:00:00.000Z') }),
    );
    expect(skipped.fields?.occurredAt).toBe('groups.settlement.errors.dateSkipped');
  });

  it('rejects an amount above the maximum', () => {
    const result = buildSettlementRequest(
      baseValues({ amount: '10.000.000.000.000,01' }),
      context(),
    );
    expect(result.request).toBeUndefined();
    expect(result.fields?.amount).toBe('groups.settlement.errors.amountOutOfRange');
  });

  it('reports every invalid field at once', () => {
    const result = buildSettlementRequest(
      baseValues({ amount: '', occurredAt: '', toMemberId: BRUNO }),
      context(),
    );
    expect(Object.keys(result.fields ?? {}).sort()).toEqual(['amount', 'occurredAt', 'toMember']);
  });
});

const preview = (overrides: Partial<ConsolidationPreview> = {}): ConsolidationPreview => ({
  legs: { ARS: '500000', USD: '-1000' },
  defaultRateType: 'blue',
  rate: '10000000',
  ...overrides,
});

const choice = (overrides: Partial<Parameters<typeof buildConsolidationRequest>[1]> = {}) => ({
  memberA: ANA,
  memberB: BRUNO,
  currency: 'ARS',
  occurredAt: '2026-10-11T09:00',
  rate: null,
  ...overrides,
});

const consolidationContext = {
  memberIds: [ANA, BRUNO, CARLA],
  timeZone: TZ,
  locale: 'es',
  now: NOW,
};

describe('buildConsolidationRequest', () => {
  it('carries the preview legs verbatim and the members in preview order', () => {
    const result = buildConsolidationRequest(preview(), choice(), consolidationContext);
    expect(result.fields).toBeUndefined();
    expect(result.request).toEqual({
      kind: 'consolidated',
      memberIds: [ANA, BRUNO],
      currency: 'ARS',
      occurredAt: '2026-10-11T12:00:00.000Z',
      legs: { ARS: '500000', USD: '-1000' },
    });
    expect(result.request).not.toHaveProperty('rate');
  });

  it.each([
    ['1.234,5678', 'es'],
    ['1,234.5678', 'en'],
  ])('sends the manual rate %s (%s) as the scaled string 12345678', (typed, locale) => {
    const result = buildConsolidationRequest(preview(), choice({ rate: typed }), {
      ...consolidationContext,
      locale,
    });
    expect(result.request).toMatchObject({ rate: '12345678' });
  });

  it.each(['', '0', '-3', 'abc', '0,00001'])('rejects the manual rate %j', (rate) => {
    const result = buildConsolidationRequest(preview(), choice({ rate }), consolidationContext);
    expect(result.request).toBeUndefined();
    expect(result.fields?.rate).toMatch(/^groups\.consolidate\.errors\./);
  });

  it('requires a manual rate when the group has no stored rate', () => {
    const result = buildConsolidationRequest(
      preview({ rate: null }),
      choice(),
      consolidationContext,
    );
    expect(result.request).toBeUndefined();
    expect(result.fields?.rate).toBe('groups.consolidate.errors.rateRequired');
    const typed = buildConsolidationRequest(
      preview({ rate: null }),
      choice({ rate: '1000' }),
      consolidationContext,
    );
    expect(typed.request).toMatchObject({ rate: '10000000' });
  });

  it('offers nothing to record when either leg is 0', () => {
    for (const legs of [
      { ARS: '0', USD: '-1000' },
      { ARS: '500000', USD: '0' },
    ]) {
      const result = buildConsolidationRequest(preview({ legs }), choice(), consolidationContext);
      expect(result.request).toBeUndefined();
      expect(result.fields?.legs).toBe('groups.consolidate.errors.nothingToConsolidate');
    }
  });

  it('rejects equal members, unknown members, a bad currency and a bad date', () => {
    expect(
      buildConsolidationRequest(preview(), choice({ memberB: ANA }), consolidationContext).fields
        ?.memberB,
    ).toBe('groups.consolidate.errors.sameMember');
    expect(
      buildConsolidationRequest(preview(), choice({ memberA: LUIS }), consolidationContext).fields
        ?.memberA,
    ).toBe('groups.consolidate.errors.memberRequired');
    expect(
      buildConsolidationRequest(preview(), choice({ currency: 'EUR' }), consolidationContext).fields
        ?.currency,
    ).toBe('groups.consolidate.errors.currencyInvalid');
    expect(
      buildConsolidationRequest(
        preview(),
        choice({ occurredAt: '2026-10-12T09:00' }),
        consolidationContext,
      ).fields?.occurredAt,
    ).toBe('groups.consolidate.errors.dateInFuture');
  });

  it('rejects a cash above the movement maximum', () => {
    const result = buildConsolidationRequest(
      preview({ legs: { ARS: '1000000000000000', USD: '1000' } }),
      choice(),
      consolidationContext,
    );
    expect(result.request).toBeUndefined();
    expect(result.fields?.rate).toBe('groups.consolidate.errors.cashOutOfRange');
  });
});

describe('cashOf', () => {
  it.each([
    // [legs ARS, legs USD, currency, rate, amount, swapped]
    ['500000', '1000', 'ARS', 10_000_000n, 1_500_000n, false],
    ['-2000000', '1000', 'ARS', 10_000_000n, 1_000_000n, true],
    ['1000000', '-500', 'USD', 10_000_000n, 500n, false],
    ['300000', '-1000', 'USD', 10_000_000n, 700n, true],
    ['1000000', '-1000', 'ARS', 10_000_000n, 0n, false],
  ] as const)('ARS %s USD %s in %s at %s', (ars, usd, currency, rate, amount, swapped) => {
    expect(cashOf(preview({ legs: { ARS: ars, USD: usd } }), currency, rate)).toEqual({
      amount,
      swapped,
    });
  });

  it('rounds the converted leg half up like the API', () => {
    // 1 USD cent at 1,234.5678 ARS/USD is 1234.5678 ARS cents, rounded to 1235.
    expect(cashOf(preview({ legs: { ARS: '0', USD: '1' } }), 'ARS', 12_345_678n)).toEqual({
      amount: 1235n,
      swapped: false,
    });
    expect(cashOf(preview({ legs: { ARS: '0', USD: '-1' } }), 'ARS', 12_345_678n)).toEqual({
      amount: 1235n,
      swapped: true,
    });
  });
});
