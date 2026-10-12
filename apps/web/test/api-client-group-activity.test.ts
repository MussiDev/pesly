import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';
const GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const MEMBER = '33333333-3333-4333-8333-333333333333';
const OCCURRED_AT = '2026-10-03T10:00:00.000Z';

const ENTRY = {
  id: '77777777-7777-4777-8777-777777777777',
  action: 'expense_updated',
  subjectType: 'expense',
  subjectId: '88888888-8888-4888-8888-888888888888',
  memberId: MEMBER,
  createdAt: '2026-10-04T10:00:00.000Z',
  before: {
    amount: '1000',
    currency: 'ARS',
    occurredAt: OCCURRED_AT,
    categoryId: 'cat',
    description: 'Dinner',
    splitMode: 'equal',
    payerMemberId: MEMBER,
    shares: [{ memberId: MEMBER, amount: '1000' }],
  },
  after: {
    amount: '2000',
    currency: 'ARS',
    occurredAt: OCCURRED_AT,
    categoryId: 'cat',
    description: 'Dinner',
    splitMode: 'equal',
    payerMemberId: MEMBER,
    shares: [{ memberId: MEMBER, amount: '2000' }],
  },
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

describe('api client: group activity (DISC-001-05h Block 1)', () => {
  it('listGroupActivity calls GET /groups/:id/activity with limit and cursor (AC-01)', async () => {
    const page = { items: [ENTRY], nextCursor: 'abc+/=' };
    const { client, fetch } = clientWith(jsonResponse(200, page), jsonResponse(200, page));

    const result = await client.listGroupActivity(GROUP, { limit: 50, cursor: 'abc+/=' });
    await client.listGroupActivity(GROUP, {});

    expect(result).toEqual({ ok: true, data: page });
    const first = requestAt(fetch, 0);
    const url = new URL(first.url);
    expect(first.init.method).toBe('GET');
    expect(url.pathname).toBe(`/groups/${GROUP}/activity`);
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('cursor')).toBe('abc+/=');
    expect(requestAt(fetch, 1).url).toBe(`${BASE_URL}/groups/${GROUP}/activity`);
  });

  it('an unknown action, a numeric amount or an extra key is a failure with no data (AC-02)', async () => {
    const page = (entry: unknown) => jsonResponse(200, { items: [entry], nextCursor: null });
    const { client } = clientWith(
      page({ ...ENTRY, action: 'expense_exploded' }),
      page({ ...ENTRY, after: { ...ENTRY.after, amount: 2000 } }),
      page({ ...ENTRY, extra: true }),
    );

    for (let i = 0; i < 3; i += 1) {
      const result = await client.listGroupActivity(GROUP, {});
      expect(result).toMatchObject({ ok: false, code: 'INTERNAL' });
      expect(result).not.toHaveProperty('data');
    }
  });

  it('a 404 for a group the user is not in is NOT_FOUND (AC-33)', async () => {
    const { client } = clientWith(jsonResponse(404, { code: 'NOT_FOUND' }));

    const result = await client.listGroupActivity(GROUP, {});

    expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('refuses a malformed group id, a limit of 0 and an empty cursor before any request', async () => {
    const { client, fetch } = clientWith();

    const results = [
      await client.listGroupActivity('..', {}),
      await client.listGroupActivity(GROUP, { limit: 0 }),
      await client.listGroupActivity(GROUP, { limit: 101 }),
      await client.listGroupActivity(GROUP, { cursor: '' }),
      await client.listGroupActivity(GROUP, { cursor: 'x'.repeat(513) }),
    ];

    for (const result of results) {
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
