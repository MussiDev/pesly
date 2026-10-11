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

const TOKEN = 'A'.repeat(43);
const GROUP_RECORD = {
  id: GROUP,
  name: 'Casa',
  defaultRateType: 'blue',
  role: 'admin',
  memberCount: 2,
  createdAt: '2026-10-01T10:00:00.000Z',
};
const MEMBER_RECORD = {
  id: MEMBER_B,
  displayName: 'Ana',
  isGhost: true,
  role: 'member',
  joinedAt: '2026-10-01T10:00:00.000Z',
};
const GROUP_CATEGORY = {
  id: CATEGORY,
  defaultKey: null,
  name: 'Comida',
  icon: 'utensils',
  color: 'red',
  archivedAt: null,
};

describe('api client: group screens (DISC-001-05e Block 1)', () => {
  it('createGroup sends the body and returns the parsed group', async () => {
    const { client, fetch } = clientWith(jsonResponse(201, GROUP_RECORD));

    const result = await client.createGroup({ name: 'Casa', defaultRateType: 'blue' });

    expect(result).toEqual({ ok: true, data: GROUP_RECORD });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/groups`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Casa', defaultRateType: 'blue' });
  });

  it('listGroups, getGroup and updateGroupRateType use their routes', async () => {
    const detail = { ...GROUP_RECORD, members: [MEMBER_RECORD], formerMembers: [] };
    const { client, fetch } = clientWith(
      jsonResponse(200, [GROUP_RECORD]),
      jsonResponse(200, detail),
      jsonResponse(200, { ...GROUP_RECORD, defaultRateType: 'oficial' }),
    );

    const list = await client.listGroups();
    const one = await client.getGroup(GROUP);
    const updated = await client.updateGroupRateType(GROUP, { defaultRateType: 'oficial' });

    expect(list).toEqual({ ok: true, data: [GROUP_RECORD] });
    expect(one).toEqual({ ok: true, data: detail });
    expect(updated.ok).toBe(true);
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/groups`);
    expect(requestAt(fetch, 1).url).toBe(`${BASE_URL}/groups/${GROUP}`);
    expect(requestAt(fetch, 2).init.method).toBe('PATCH');
    expect(JSON.parse(requestAt(fetch, 2).init.body as string)).toEqual({
      defaultRateType: 'oficial',
    });
  });

  it('joinGroup and claimGroupSeat send the token in the body', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, GROUP_RECORD),
      jsonResponse(200, GROUP_RECORD),
    );

    const joined = await client.joinGroup(TOKEN);
    const claimed = await client.claimGroupSeat(TOKEN);

    expect(joined.ok && claimed.ok).toBe(true);
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/groups/join`);
    expect(JSON.parse(requestAt(fetch, 0).init.body as string)).toEqual({ token: TOKEN });
    expect(requestAt(fetch, 1).url).toBe(`${BASE_URL}/groups/claim`);
    expect(JSON.parse(requestAt(fetch, 1).init.body as string)).toEqual({ token: TOKEN });
  });

  it('an empty or oversized token is refused before any request', async () => {
    const { client, fetch } = clientWith();

    const empty = await client.joinGroup('');
    const blank = await client.claimGroupSeat('   ');
    const huge = await client.joinGroup('x'.repeat(201));

    for (const result of [empty, blank, huge]) {
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a bad token answer maps to its own key, and so do already-member and full group', async () => {
    const { client } = clientWith(
      jsonResponse(400, { code: 'TOKEN_INVALID' }),
      jsonResponse(409, { code: 'GROUP_ALREADY_MEMBER' }),
      jsonResponse(409, { code: 'GROUP_MEMBER_LIMIT_REACHED' }),
    );

    expect(await client.joinGroup(TOKEN)).toMatchObject({
      code: 'TOKEN_INVALID',
      messageKey: 'tokenInvalid',
    });
    expect(await client.joinGroup(TOKEN)).toMatchObject({ messageKey: 'groupAlreadyMember' });
    expect(await client.joinGroup(TOKEN)).toMatchObject({ messageKey: 'groupMemberLimitReached' });
  });

  it('invitation, ghost member, claim link and promote use their routes', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(201, { token: TOKEN, expiresAt: '2026-10-08T10:00:00.000Z' }),
      jsonResponse(201, MEMBER_RECORD),
      jsonResponse(201, { token: TOKEN }),
      jsonResponse(200, { ...MEMBER_RECORD, role: 'admin' }),
    );

    const invitation = await client.createInvitation(GROUP);
    const ghost = await client.addGhostMember(GROUP, { displayName: 'Ana' });
    const link = await client.createClaimLink(GROUP, MEMBER_B);
    const promoted = await client.promoteMember(GROUP, MEMBER_B);

    expect(invitation).toMatchObject({ ok: true, data: { token: TOKEN } });
    expect(ghost).toEqual({ ok: true, data: MEMBER_RECORD });
    expect(link).toEqual({ ok: true, data: { token: TOKEN } });
    expect(promoted).toMatchObject({ ok: true, data: { role: 'admin' } });
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/groups/${GROUP}/invitations`);
    expect(requestAt(fetch, 1).url).toBe(`${BASE_URL}/groups/${GROUP}/ghost-members`);
    expect(JSON.parse(requestAt(fetch, 1).init.body as string)).toEqual({ displayName: 'Ana' });
    expect(requestAt(fetch, 2).url).toBe(
      `${BASE_URL}/groups/${GROUP}/members/${MEMBER_B}/claim-links`,
    );
    expect(requestAt(fetch, 3).url).toBe(`${BASE_URL}/groups/${GROUP}/members/${MEMBER_B}/admin`);
    expect(requestAt(fetch, 3).init.method).toBe('POST');
  });

  it('removeMember and leaveGroup answer 204 as success', async () => {
    const { client, fetch } = clientWith(
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    );

    const removed = await client.removeMember(GROUP, MEMBER_B);
    const left = await client.leaveGroup(GROUP);

    expect(removed).toEqual({ ok: true, data: undefined });
    expect(left).toEqual({ ok: true, data: undefined });
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/groups/${GROUP}/members/${MEMBER_B}`);
    expect(requestAt(fetch, 0).init.method).toBe('DELETE');
    expect(requestAt(fetch, 1).url).toBe(`${BASE_URL}/groups/${GROUP}/leave`);
    expect(requestAt(fetch, 1).init.method).toBe('POST');
  });

  it('group categories: list, create and update', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, [GROUP_CATEGORY]),
      jsonResponse(201, GROUP_CATEGORY),
      jsonResponse(200, { ...GROUP_CATEGORY, archivedAt: '2026-10-05T10:00:00.000Z' }),
    );

    const list = await client.listGroupCategories(GROUP);
    const created = await client.createGroupCategory(GROUP, {
      name: 'Comida',
      icon: 'utensils',
      color: 'red',
    });
    const updated = await client.updateGroupCategory(GROUP, CATEGORY, { archived: true });

    expect(list).toEqual({ ok: true, data: [GROUP_CATEGORY] });
    expect(created.ok && updated.ok).toBe(true);
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/groups/${GROUP}/categories`);
    expect(requestAt(fetch, 1).init.method).toBe('POST');
    expect(requestAt(fetch, 2).url).toBe(`${BASE_URL}/groups/${GROUP}/categories/${CATEGORY}`);
    expect(requestAt(fetch, 2).init.method).toBe('PATCH');
    expect(JSON.parse(requestAt(fetch, 2).init.body as string)).toEqual({ archived: true });
  });

  it('a 404 stays not found and a 403 stays forbidden for member actions', async () => {
    const { client } = clientWith(
      jsonResponse(404, { code: 'NOT_FOUND' }),
      jsonResponse(403, { code: 'GROUP_ADMIN_REQUIRED' }),
    );

    expect(await client.removeMember(GROUP, MEMBER_B)).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(await client.promoteMember(GROUP, MEMBER_B)).toMatchObject({
      ok: false,
      code: 'GROUP_ADMIN_REQUIRED',
      messageKey: 'groupAdminRequired',
    });
  });

  it('a GROUP_MEMBER_HAS_BALANCE 409 exposes the amounts per currency', async () => {
    const body = {
      code: 'GROUP_MEMBER_HAS_BALANCE',
      details: { ARS: '-12000', USD: '500' },
    };
    const { client } = clientWith(jsonResponse(409, body), jsonResponse(409, body));

    const left = await client.leaveGroup(GROUP);
    const removed = await client.removeMember(GROUP, MEMBER_B);

    for (const result of [left, removed]) {
      expect(result).toMatchObject({
        ok: false,
        code: 'GROUP_MEMBER_HAS_BALANCE',
        messageKey: 'groupMemberHasBalance',
        balances: { ARS: '-12000', USD: '500' },
      });
    }
  });

  it('balance details that are not numeric strings are not exposed', async () => {
    const { client } = clientWith(
      jsonResponse(409, { code: 'GROUP_MEMBER_HAS_BALANCE', details: { ARS: 'abc', USD: '5' } }),
      jsonResponse(409, { code: 'GROUP_MEMBER_HAS_BALANCE' }),
    );

    const bad = await client.leaveGroup(GROUP);
    const missing = await client.leaveGroup(GROUP);

    expect(bad).toMatchObject({ ok: false, code: 'GROUP_MEMBER_HAS_BALANCE' });
    expect(bad).not.toHaveProperty('balances');
    expect(missing).not.toHaveProperty('balances');
  });

  it('a GROUP_LAST_ADMIN 409 surfaces its own key', async () => {
    const { client } = clientWith(jsonResponse(409, { code: 'GROUP_LAST_ADMIN' }));

    expect(await client.leaveGroup(GROUP)).toMatchObject({
      ok: false,
      code: 'GROUP_LAST_ADMIN',
      messageKey: 'groupLastAdmin',
    });
  });

  it('a malformed body is an INTERNAL error, not data', async () => {
    const { client } = clientWith(
      jsonResponse(200, [{ id: GROUP }]),
      jsonResponse(201, { ...GROUP_RECORD, defaultRateType: 'nope' }),
    );

    expect(await client.listGroups()).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(await client.createGroup({ name: 'Casa', defaultRateType: 'blue' })).toMatchObject({
      ok: false,
      code: 'INTERNAL',
    });
  });

  it('a path segment that is not a plain id is refused before any request', async () => {
    const { client, fetch } = clientWith();

    const result = await client.removeMember('..', MEMBER_B);

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
