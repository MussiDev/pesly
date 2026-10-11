import type { UpdateGroupExpenseRequest } from '@pesly/shared';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient, isGroupRecordConflict, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';
const GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const EXPENSE = '11111111-1111-4111-8111-111111111111';
const SETTLEMENT = '22222222-2222-4222-8222-222222222222';
const MEMBER_A = '33333333-3333-4333-8333-333333333333';
const MEMBER_B = '44444444-4444-4444-8444-444444444444';
const CATEGORY = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';

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
  version: 3,
};

const SETTLEMENT_RECORD = {
  id: SETTLEMENT,
  groupId: GROUP,
  fromMemberId: MEMBER_A,
  toMemberId: MEMBER_B,
  currency: 'ARS',
  amount: '2500',
  legs: [{ currency: 'ARS', amount: '2500' }],
  occurredAt: '2026-10-03T10:00:00.000Z',
  createdByMemberId: MEMBER_A,
  accountId: null,
  rate: null,
  rateSource: null,
  rateType: null,
  createdAt: '2026-10-03T10:01:00.000Z',
  version: 2,
};

const UPDATE_EXPENSE: UpdateGroupExpenseRequest = {
  amount: '12000',
  occurredAt: '2026-10-02T15:30:00.000Z',
  categoryId: CATEGORY,
  description: 'dinner',
  split: { mode: 'equal', memberIds: [MEMBER_A, MEMBER_B] },
  baseVersion: 2,
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

describe('api client: group changes (DISC-001-04e Block 5)', () => {
  it('getGroupExpense and getSettlement read the record with its version', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, EXPENSE_RECORD),
      jsonResponse(200, SETTLEMENT_RECORD),
    );

    const expense = await client.getGroupExpense(GROUP, EXPENSE);
    const settlement = await client.getSettlement(GROUP, SETTLEMENT);

    expect(expense).toEqual({ ok: true, data: EXPENSE_RECORD });
    expect(settlement).toEqual({ ok: true, data: SETTLEMENT_RECORD });
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/groups/${GROUP}/expenses/${EXPENSE}`);
    expect(requestAt(fetch, 1).url).toBe(`${BASE_URL}/groups/${GROUP}/settlements/${SETTLEMENT}`);
  });

  it('updateGroupExpense sends baseVersion in the PUT body', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, { ...EXPENSE_RECORD, version: 3 }));

    const result = await client.updateGroupExpense(GROUP, EXPENSE, UPDATE_EXPENSE);

    expect(result.ok).toBe(true);
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/groups/${GROUP}/expenses/${EXPENSE}`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toMatchObject({ baseVersion: 2, amount: '12000' });
  });

  it('updateSettlement sends baseVersion in the PATCH body', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, { ...SETTLEMENT_RECORD, version: 3 }));

    await client.updateSettlement(GROUP, SETTLEMENT, { amount: '3000', baseVersion: 2 });

    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/groups/${GROUP}/settlements/${SETTLEMENT}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ amount: '3000', baseVersion: 2 });
  });

  it('deleteGroupExpense and deleteSettlement send baseVersion in the query', async () => {
    const { client, fetch } = clientWith(
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    );

    const expense = await client.deleteGroupExpense(GROUP, EXPENSE, 4);
    const settlement = await client.deleteSettlement(GROUP, SETTLEMENT, 5);

    expect(expense).toEqual({ ok: true, data: undefined });
    expect(settlement).toEqual({ ok: true, data: undefined });
    expect(requestAt(fetch, 0).url).toBe(
      `${BASE_URL}/groups/${GROUP}/expenses/${EXPENSE}?baseVersion=4`,
    );
    expect(requestAt(fetch, 0).init.method).toBe('DELETE');
    expect(requestAt(fetch, 1).url).toBe(
      `${BASE_URL}/groups/${GROUP}/settlements/${SETTLEMENT}?baseVersion=5`,
    );
  });

  it('a 409 GROUP_RECORD_CONFLICT is a conflict outcome carrying the server expense (AC-02)', async () => {
    const { client } = clientWith(
      jsonResponse(409, {
        code: 'GROUP_RECORD_CONFLICT',
        details: { current: EXPENSE_RECORD },
      }),
    );

    const result = await client.updateGroupExpense(GROUP, EXPENSE, UPDATE_EXPENSE);

    expect(isGroupRecordConflict(result)).toBe(true);
    if (!isGroupRecordConflict(result)) throw new Error('expected a conflict');
    expect(result.code).toBe('GROUP_RECORD_CONFLICT');
    expect(result.messageKey).toBe('groupRecordConflict');
    expect(result.current).toEqual(EXPENSE_RECORD);
  });

  it('a 409 conflict on a settlement delete carries the server settlement', async () => {
    const { client } = clientWith(
      jsonResponse(409, {
        code: 'GROUP_RECORD_CONFLICT',
        details: { current: SETTLEMENT_RECORD },
      }),
    );

    const result = await client.deleteSettlement(GROUP, SETTLEMENT, 1);

    if (!isGroupRecordConflict(result)) throw new Error('expected a conflict');
    expect(result.current).toEqual(SETTLEMENT_RECORD);
  });

  it('a malformed 409 body is a generic failure, not a conflict', async () => {
    const { client } = clientWith(
      jsonResponse(409, { code: 'GROUP_RECORD_CONFLICT', details: { current: { id: 'x' } } }),
      jsonResponse(409, { code: 'GROUP_RECORD_CONFLICT' }),
      jsonResponse(409, 'nope'),
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await client.updateGroupExpense(GROUP, EXPENSE, UPDATE_EXPENSE);
      expect(isGroupRecordConflict(result)).toBe(false);
      expect(result).toMatchObject({ ok: false, code: 'INTERNAL', messageKey: 'unexpected' });
    }
  });

  it('an existing 409 code with no record stays its own failure', async () => {
    const { client } = clientWith(jsonResponse(409, { code: 'GROUP_SETTLEMENT_CONSOLIDATED' }));

    const result = await client.updateSettlement(GROUP, SETTLEMENT, {
      amount: '1',
      baseVersion: 1,
    });

    expect(isGroupRecordConflict(result)).toBe(false);
    expect(result).toMatchObject({ ok: false, code: 'GROUP_SETTLEMENT_CONSOLIDATED' });
  });

  it('a 404 stays not found and a 403 stays forbidden', async () => {
    const { client } = clientWith(
      jsonResponse(404, { code: 'NOT_FOUND' }),
      jsonResponse(403, { code: 'GROUP_RECORD_EDIT_FORBIDDEN' }),
    );

    const missing = await client.deleteGroupExpense(GROUP, EXPENSE, 1);
    const forbidden = await client.updateGroupExpense(GROUP, EXPENSE, UPDATE_EXPENSE);

    expect(isGroupRecordConflict(missing)).toBe(false);
    expect(missing).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(isGroupRecordConflict(forbidden)).toBe(false);
    expect(forbidden).toMatchObject({
      ok: false,
      code: 'GROUP_RECORD_EDIT_FORBIDDEN',
      messageKey: 'groupRecordEditForbidden',
    });
  });

  it('a path segment that is not a plain id is refused before any request', async () => {
    const { client, fetch } = clientWith();

    const result = await client.getGroupExpense(GROUP, '..');

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a network failure stays a network failure, never a conflict', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.reject(new TypeError('offline')));
    const client = createApiClient({ baseUrl: BASE_URL, fetch });

    const result = await client.updateGroupExpense(GROUP, EXPENSE, UPDATE_EXPENSE);

    expect(isGroupRecordConflict(result)).toBe(false);
    expect(result).toMatchObject({ ok: false, code: 'NETWORK' });
  });
});
