import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';
const GROUP = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const CATEGORY = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';
const FROM = '2026-10-01T03:00:00.000Z';
const TO = '2026-11-01T02:59:59.999Z';

const SUMMARY = {
  from: FROM,
  to: TO,
  currencies: [
    {
      currency: 'ARS',
      total: '15000',
      count: 2,
      categories: [{ categoryId: CATEGORY, total: '15000', count: 2 }],
    },
  ],
  categories: [
    {
      id: CATEGORY,
      defaultKey: null,
      name: 'Food',
      icon: 'utensils',
      color: 'orange',
      archivedAt: null,
    },
  ],
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

function urlAt(fetch: ReturnType<typeof clientWith>['fetch'], index: number) {
  const call = fetch.mock.calls[index];
  if (!call) throw new Error(`no fetch call #${index}`);
  return { url: call[0], init: call[1] ?? {} };
}

describe('api client: group expense summary (DISC-001-05j Block 4)', () => {
  it('getGroupExpenseSummary calls the summary route with from and to and keeps string totals', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, SUMMARY));

    const result = await client.getGroupExpenseSummary(GROUP, { from: FROM, to: TO });

    expect(result).toEqual({ ok: true, data: SUMMARY });
    const { url, init } = urlAt(fetch, 0);
    expect(url).toBe(
      `${BASE_URL}/groups/${GROUP}/expenses/summary?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
    );
    expect(init.method).toBe('GET');
  });

  it('a numeric total or an unknown currency is a failure with no data', async () => {
    const numeric = {
      ...SUMMARY,
      currencies: [{ ...SUMMARY.currencies[0], total: 15000 }],
    };
    const unknown = {
      ...SUMMARY,
      currencies: [{ ...SUMMARY.currencies[0], currency: 'EUR' }],
    };
    const { client } = clientWith(jsonResponse(200, numeric), jsonResponse(200, unknown));

    for (let i = 0; i < 2; i += 1) {
      const result = await client.getGroupExpenseSummary(GROUP, { from: FROM, to: TO });
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty('data');
    }
  });

  it('refuses a reversed range, a range above 366 days and a malformed group id without a request', async () => {
    const { client, fetch } = clientWith();

    expect(await client.getGroupExpenseSummary(GROUP, { from: TO, to: FROM })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(
      await client.getGroupExpenseSummary(GROUP, {
        from: '2024-01-01T00:00:00.000Z',
        to: '2026-01-01T00:00:00.000Z',
      }),
    ).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await client.getGroupExpenseSummary('..', { from: FROM, to: TO })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(
      await client.getGroupExpenseSummary(GROUP, { from: FROM } as unknown as {
        from: string;
        to: string;
      }),
    ).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a 404 is NOT_FOUND', async () => {
    const { client } = clientWith(jsonResponse(404, { code: 'NOT_FOUND' }));

    expect(await client.getGroupExpenseSummary(GROUP, { from: FROM, to: TO })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });
});
