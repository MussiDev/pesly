import { parseAmountInput, type CreateSettlementRequest } from '@pesly/shared';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';
const GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const SETTLEMENT = '22222222-2222-4222-8222-222222222222';
const MEMBER_A = '33333333-3333-4333-8333-333333333333';
const MEMBER_B = '44444444-4444-4444-8444-444444444444';
const ACCOUNT = '55555555-5555-4555-8555-555555555555';
const OCCURRED_AT = '2026-10-03T10:00:00.000Z';

const SETTLEMENT_RECORD = {
  id: SETTLEMENT,
  groupId: GROUP,
  fromMemberId: MEMBER_A,
  toMemberId: MEMBER_B,
  currency: 'ARS',
  amount: '2500',
  legs: [{ currency: 'ARS', amount: '2500' }],
  occurredAt: OCCURRED_AT,
  createdByMemberId: MEMBER_A,
  accountId: null,
  rate: null,
  rateSource: null,
  rateType: null,
  createdAt: '2026-10-03T10:01:00.000Z',
  version: 1,
};

const BALANCES = {
  ARS: {
    members: [
      { memberId: MEMBER_A, balance: '-2500' },
      { memberId: MEMBER_B, balance: '2500' },
    ],
    payments: [{ fromMemberId: MEMBER_A, toMemberId: MEMBER_B, amount: '2500' }],
  },
  USD: { members: [], payments: [] },
};

const SINGLE: CreateSettlementRequest = {
  kind: 'single',
  fromMemberId: MEMBER_A,
  toMemberId: MEMBER_B,
  currency: 'ARS',
  amount: '2500',
  occurredAt: OCCURRED_AT,
};

const CONSOLIDATED: CreateSettlementRequest = {
  kind: 'consolidated',
  memberIds: [MEMBER_A, MEMBER_B],
  currency: 'USD',
  occurredAt: OCCURRED_AT,
  accountId: ACCOUNT,
  rate: '12500000',
  legs: { ARS: '-100000', USD: '500' },
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientWith(...responses: Response[]) {
  const queue = [...responses];
  const fetch = vi.fn<FetchLike>(() => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch call');
    return Promise.resolve(next);
  });
  return { client: createApiClient({ baseUrl: BASE_URL, fetch }), fetch };
}

function requestAt(fetch: ReturnType<typeof clientWith>['fetch'], index: number) {
  const call = fetch.mock.calls[index];
  if (!call) throw new Error(`no fetch call #${index}`);
  const [url, init] = call;
  return { url, init: init ?? {} };
}

describe('api client: group balances and settlements (DISC-001-05g Block 1)', () => {
  it('getGroupBalances calls GET /groups/:id/balances and returns the balances (AC-01)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, BALANCES));

    const result = await client.getGroupBalances(GROUP);

    expect(result).toEqual({ ok: true, data: BALANCES });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/groups/${GROUP}/balances`);
    expect(init.method).toBe('GET');
  });

  it('listSettlements sends limit and cursor and returns items with nextCursor (AC-01)', async () => {
    const page = {
      items: [SETTLEMENT_RECORD],
      nextCursor: 'abc+/=',
      totals: [
        { fromMemberId: 'm1', toMemberId: 'm2', currency: 'ARS', amount: '150050', count: 1 },
      ],
    };
    const { client, fetch } = clientWith(jsonResponse(200, page), jsonResponse(200, page));

    const result = await client.listSettlements(GROUP, { limit: 20, cursor: 'abc+/=' });
    await client.listSettlements(GROUP, {});

    expect(result).toEqual({ ok: true, data: page });
    const url = new URL(requestAt(fetch, 0).url);
    expect(url.pathname).toBe(`/groups/${GROUP}/settlements`);
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('cursor')).toBe('abc+/=');
    expect(requestAt(fetch, 1).url).toBe(`${BASE_URL}/groups/${GROUP}/settlements`);
  });

  it('createSettlement sends a single and a consolidated body and returns the settlement (AC-01)', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(201, SETTLEMENT_RECORD),
      jsonResponse(201, SETTLEMENT_RECORD),
    );

    const single = await client.createSettlement(GROUP, SINGLE);
    const consolidated = await client.createSettlement(GROUP, CONSOLIDATED);

    expect(single).toEqual({ ok: true, data: SETTLEMENT_RECORD });
    expect(consolidated.ok).toBe(true);
    const first = requestAt(fetch, 0);
    expect(first.url).toBe(`${BASE_URL}/groups/${GROUP}/settlements`);
    expect(first.init.method).toBe('POST');
    expect(JSON.parse(first.init.body as string)).toEqual(SINGLE);
    expect(JSON.parse(requestAt(fetch, 1).init.body as string)).toEqual(CONSOLIDATED);
  });

  it('getConsolidationPreview sends memberA, memberB and currency and returns the preview (AC-01)', async () => {
    const withRate = {
      legs: { ARS: '-100000', USD: '500' },
      defaultRateType: 'blue',
      rate: '12500000',
    };
    const noRate = { legs: { ARS: '0', USD: '500' }, defaultRateType: 'oficial', rate: null };
    const { client, fetch } = clientWith(jsonResponse(200, withRate), jsonResponse(200, noRate));

    const first = await client.getConsolidationPreview(GROUP, {
      memberA: MEMBER_A,
      memberB: MEMBER_B,
      currency: 'USD',
    });
    const second = await client.getConsolidationPreview(GROUP, {
      memberA: MEMBER_A,
      memberB: MEMBER_B,
      currency: 'ARS',
    });

    expect(first).toEqual({ ok: true, data: withRate });
    expect(second).toEqual({ ok: true, data: noRate });
    const url = new URL(requestAt(fetch, 0).url);
    expect(url.pathname).toBe(`/groups/${GROUP}/settlements/consolidation`);
    expect(url.searchParams.get('memberA')).toBe(MEMBER_A);
    expect(url.searchParams.get('memberB')).toBe(MEMBER_B);
    expect(url.searchParams.get('currency')).toBe('USD');
  });

  it('1,000 random typed amounts reach the body as the exact minor-units string (NFR-04)', async () => {
    let seed = 20261011;
    const next = (bound: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed % bound;
    };
    const { client, fetch } = clientWith(
      ...Array.from({ length: 1000 }, () => jsonResponse(201, SETTLEMENT_RECORD)),
    );

    const expected: string[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const digits = 1 + next(12);
      let whole = String(1 + next(9));
      for (let d = 1; d < digits; d += 1) whole += String(next(10));
      const cents = String(next(100)).padStart(2, '0');
      const minor = BigInt(whole) * 100n + BigInt(cents);
      const groups = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      const parsed = parseAmountInput(`${groups},${cents}`, 'es-AR');
      expect(parsed).toBe(minor);
      expected.push(minor.toString());
      await client.createSettlement(GROUP, { ...SINGLE, amount: String(parsed) });
    }

    for (let i = 0; i < 1000; i += 1) {
      const body = JSON.parse(requestAt(fetch, i).init.body as string) as { amount: unknown };
      expect(body.amount).toBe(expected[i]);
    }
  });

  it('surfaces the keys of a 400 member-invalid and a 400 nothing-to-consolidate (AC-09, AC-13)', async () => {
    const { client } = clientWith(
      jsonResponse(400, { code: 'GROUP_SETTLEMENT_MEMBER_INVALID' }),
      jsonResponse(400, { code: 'GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE' }),
    );

    const member = await client.createSettlement(GROUP, SINGLE);
    const nothing = await client.getConsolidationPreview(GROUP, {
      memberA: MEMBER_A,
      memberB: MEMBER_B,
      currency: 'ARS',
    });

    expect(member).toMatchObject({
      ok: false,
      code: 'GROUP_SETTLEMENT_MEMBER_INVALID',
      messageKey: 'groupSettlementMemberInvalid',
    });
    expect(nothing).toMatchObject({
      ok: false,
      code: 'GROUP_SETTLEMENT_NOTHING_TO_CONSOLIDATE',
      messageKey: 'groupSettlementNothingToConsolidate',
    });
  });

  it('a 409 GROUP_SETTLEMENT_STALE is an ordinary failure with its key (AC-17)', async () => {
    const { client } = clientWith(jsonResponse(409, { code: 'GROUP_SETTLEMENT_STALE' }));

    const result = await client.createSettlement(GROUP, CONSOLIDATED);

    expect(result).toMatchObject({
      ok: false,
      code: 'GROUP_SETTLEMENT_STALE',
      messageKey: 'groupSettlementStale',
    });
  });

  it('a 404 for a group the user is not in is NOT_FOUND (AC-23)', async () => {
    const { client } = clientWith(
      jsonResponse(404, { code: 'NOT_FOUND' }),
      jsonResponse(404, { code: 'NOT_FOUND' }),
    );

    const balances = await client.getGroupBalances(GROUP);
    const list = await client.listSettlements(GROUP, {});

    expect(balances).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(list).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('a malformed response body is an error, not data', async () => {
    const { client } = clientWith(
      jsonResponse(200, { ARS: { members: [], payments: [] } }),
      jsonResponse(200, { items: [{ id: 1 }], nextCursor: null }),
      jsonResponse(201, { id: SETTLEMENT }),
      jsonResponse(200, { legs: { ARS: '1.5', USD: '0' }, defaultRateType: 'blue', rate: null }),
    );

    const results = [
      await client.getGroupBalances(GROUP),
      await client.listSettlements(GROUP, {}),
      await client.createSettlement(GROUP, SINGLE),
      await client.getConsolidationPreview(GROUP, {
        memberA: MEMBER_A,
        memberB: MEMBER_B,
        currency: 'ARS',
      }),
    ];

    for (const result of results) {
      expect(result).toMatchObject({ ok: false, code: 'INTERNAL' });
    }
  });

  it('refuses a malformed group id, equal parties and equal members before any request', async () => {
    const { client, fetch } = clientWith();

    const results = [
      await client.getGroupBalances('..'),
      await client.listSettlements('', {}),
      await client.createSettlement('..', SINGLE),
      await client.createSettlement(GROUP, { ...SINGLE, toMemberId: MEMBER_A }),
      await client.getConsolidationPreview(GROUP, {
        memberA: MEMBER_A,
        memberB: MEMBER_A,
        currency: 'ARS',
      }),
      await client.getConsolidationPreview('..', {
        memberA: MEMBER_A,
        memberB: MEMBER_B,
        currency: 'ARS',
      }),
    ];

    for (const result of results) {
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
