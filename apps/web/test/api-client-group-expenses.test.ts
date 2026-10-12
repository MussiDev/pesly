import type { CreateGroupExpenseRequest } from '@pesly/shared';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';
const GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const EXPENSE = '11111111-1111-4111-8111-111111111111';
const MEMBER_A = '33333333-3333-4333-8333-333333333333';
const MEMBER_B = '44444444-4444-4444-8444-444444444444';
const CATEGORY = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';
const ACCOUNT = '55555555-5555-4555-8555-555555555555';

const EXPENSE_RECORD = {
  id: EXPENSE,
  groupId: GROUP,
  payerMemberId: MEMBER_A,
  createdByMemberId: MEMBER_A,
  amount: '10000',
  currency: 'ARS',
  occurredAt: '2026-10-02T15:30:00.000Z',
  categoryId: CATEGORY,
  description: 'dinner',
  splitMode: 'equal',
  payerMovementId: null,
  createdAt: '2026-10-02T15:31:00.000Z',
  shares: [
    { memberId: MEMBER_A, amount: '5000' },
    { memberId: MEMBER_B, amount: '5000' },
  ],
  version: 1,
};

const CREATE_BODY: CreateGroupExpenseRequest = {
  amount: '10000',
  currency: 'ARS',
  occurredAt: '2026-10-02T15:30:00.000Z',
  payerMemberId: MEMBER_A,
  categoryId: CATEGORY,
  description: 'dinner',
  split: { mode: 'equal', memberIds: [MEMBER_A, MEMBER_B] },
  payerAccount: { accountId: ACCOUNT, categoryId: CATEGORY },
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

describe('api client: group expenses (DISC-001-05f Block 1)', () => {
  it('createGroupExpense sends the body and returns the parsed expense', async () => {
    const { client, fetch } = clientWith(jsonResponse(201, EXPENSE_RECORD));

    const result = await client.createGroupExpense(GROUP, CREATE_BODY);

    expect(result).toEqual({ ok: true, data: EXPENSE_RECORD });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/groups/${GROUP}/expenses`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(CREATE_BODY);
  });

  it('createGroupExpense refuses an invalid body without sending a request', async () => {
    const { client, fetch } = clientWith();

    const result = await client.createGroupExpense(GROUP, { ...CREATE_BODY, amount: '12.5' });

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('listGroupExpenses sends limit and cursor and returns items with nextCursor', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, { items: [EXPENSE_RECORD], nextCursor: 'abc' }),
    );

    const result = await client.listGroupExpenses(GROUP, { limit: 50, cursor: 'prev' });

    expect(result).toEqual({ ok: true, data: { items: [EXPENSE_RECORD], nextCursor: 'abc' } });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/groups/${GROUP}/expenses?limit=50&cursor=prev`);
    expect(init.method).toBe('GET');
  });

  it('listGroupExpenses sends no query when nothing is given and rejects a partial page', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, { items: [], nextCursor: null }),
      jsonResponse(200, { items: [{ id: EXPENSE }], nextCursor: null }),
    );

    expect(await client.listGroupExpenses(GROUP, {})).toEqual({
      ok: true,
      data: { items: [], nextCursor: null },
    });
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/groups/${GROUP}/expenses`);
    expect(await client.listGroupExpenses(GROUP, {})).toMatchObject({
      ok: false,
      code: 'INTERNAL',
    });
  });

  it('listGroupExpenses sends categoryIds joined by commas and the range (DISC-001-05j)', async () => {
    const OTHER = '8a1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5c';
    const from = '2026-10-01T03:00:00.000Z';
    const to = '2026-11-01T02:59:59.999Z';
    const { client, fetch } = clientWith(jsonResponse(200, { items: [], nextCursor: null }));

    const result = await client.listGroupExpenses(GROUP, {
      cursor: 'prev',
      categoryIds: [CATEGORY, OTHER],
      from,
      to,
    });

    expect(result.ok).toBe(true);
    const { url, init } = requestAt(fetch, 0);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe(`/groups/${GROUP}/expenses`);
    expect(parsed.searchParams.get('categoryIds')).toBe(`${CATEGORY},${OTHER}`);
    expect(parsed.searchParams.get('from')).toBe(from);
    expect(parsed.searchParams.get('to')).toBe(to);
    expect(parsed.searchParams.get('cursor')).toBe('prev');
    expect(init.method).toBe('GET');
  });

  it('listGroupExpenses refuses a bad category id, a reversed range and a long range locally', async () => {
    const { client, fetch } = clientWith();
    const from = '2026-10-01T03:00:00.000Z';
    const to = '2026-11-01T02:59:59.999Z';

    for (const query of [
      { categoryIds: ['not-a-uuid'] },
      { categoryIds: [] },
      { from: to, to: from },
      { from: '2024-01-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' },
    ]) {
      expect(await client.listGroupExpenses(GROUP, query)).toMatchObject({
        ok: false,
        code: 'VALIDATION_FAILED',
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('listGroupExpenses answers NOT_FOUND on a 404 (DISC-001-05j)', async () => {
    const { client } = clientWith(jsonResponse(404, { code: 'NOT_FOUND' }));

    expect(await client.listGroupExpenses(GROUP, { categoryIds: [CATEGORY] })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('getExpenseOptions returns members, categories, default split and rate type', async () => {
    const options = {
      selfMemberId: MEMBER_A,
      members: [
        { id: MEMBER_A, displayName: 'Ana', isGhost: false, joinedAt: '2026-10-01T00:00:00.000Z' },
      ],
      categories: [],
      defaultSplit: { mode: 'equal' },
      defaultRateType: 'blue',
    };
    const { client, fetch } = clientWith(jsonResponse(200, options));

    const result = await client.getExpenseOptions(GROUP);

    expect(result).toMatchObject({ ok: true, data: { defaultRateType: 'blue' } });
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/groups/${GROUP}/expense-options`);
  });

  it('getExpenseOptions asks for archived categories only on request', async () => {
    const options = {
      selfMemberId: MEMBER_A,
      members: [],
      categories: [],
      defaultSplit: { mode: 'equal' },
      defaultRateType: 'blue',
    };
    const { client, fetch } = clientWith(jsonResponse(200, options));

    await client.getExpenseOptions(GROUP, { includeArchived: true });

    expect(requestAt(fetch, 0).url).toBe(
      `${BASE_URL}/groups/${GROUP}/expense-options?includeArchived=true`,
    );
  });

  it('setDefaultSplit sends equal and percentage bodies', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, { mode: 'equal' }),
      jsonResponse(200, {
        mode: 'percentage',
        shares: [
          { memberId: MEMBER_A, basisPoints: 6000 },
          { memberId: MEMBER_B, basisPoints: 4000 },
        ],
      }),
    );
    const percentage = {
      mode: 'percentage' as const,
      shares: [
        { memberId: MEMBER_A, basisPoints: 6000 },
        { memberId: MEMBER_B, basisPoints: 4000 },
      ],
    };

    expect(await client.setDefaultSplit(GROUP, { mode: 'equal' })).toEqual({
      ok: true,
      data: { mode: 'equal' },
    });
    expect(await client.setDefaultSplit(GROUP, percentage)).toMatchObject({ ok: true });

    const first = requestAt(fetch, 0);
    expect(first.url).toBe(`${BASE_URL}/groups/${GROUP}/default-split`);
    expect(first.init.method).toBe('PUT');
    expect(JSON.parse(first.init.body as string)).toEqual({ mode: 'equal' });
    expect(JSON.parse(requestAt(fetch, 1).init.body as string)).toEqual(percentage);
  });

  it('setDefaultSplit refuses an invalid body without sending a request', async () => {
    const { client, fetch } = clientWith();

    const result = await client.setDefaultSplit(GROUP, {
      mode: 'percentage',
      shares: [{ memberId: 'not-a-uuid', basisPoints: 10000 }],
    });

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('listPersonalShares sends the range and returns items with the receivable', async () => {
    const page = {
      items: [
        {
          expenseId: EXPENSE,
          groupId: GROUP,
          currency: 'ARS',
          occurredAt: '2026-10-02T15:30:00.000Z',
          shareAmount: '5000',
          receivableAmount: '5000',
        },
      ],
      nextCursor: null,
    };
    const { client, fetch } = clientWith(jsonResponse(200, page));

    const result = await client.listPersonalShares({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-11-01T00:00:00.000Z',
      limit: 20,
      cursor: 'c1',
    });

    expect(result).toEqual({ ok: true, data: page });
    const url = new URL(requestAt(fetch, 0).url);
    expect(url.pathname).toBe('/groups/personal/shares');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-11-01T00:00:00.000Z',
      limit: '20',
      cursor: 'c1',
    });
  });

  it('a 400 split refusal surfaces its own key', async () => {
    const { client } = clientWith(
      jsonResponse(400, {
        code: 'GROUP_SPLIT_AMOUNT_MISMATCH',
        message: 'x',
      }),
    );

    const result = await client.createGroupExpense(GROUP, CREATE_BODY);

    expect(result).toMatchObject({ ok: false, code: 'GROUP_SPLIT_AMOUNT_MISMATCH' });
    expect(result).toMatchObject({ messageKey: 'groupSplitAmountMismatch' });
  });

  it('a dot-segment group id is refused before any request', async () => {
    const { client, fetch } = clientWith();

    expect(await client.getExpenseOptions('..')).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});
