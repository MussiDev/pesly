import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';
const ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';

const categories = {
  currency: 'ARS',
  from: '2026-10-01',
  to: '2026-10-12',
  total: '20000000',
  categories: [{ categoryId: null, name: null, defaultKey: 'food', amount: '20000000' }],
  unconvertedShareCount: 0,
  unconvertedInstallmentCount: 0,
};

const incomeExpenses = {
  currency: 'ARS',
  from: '2025-11-01',
  to: '2026-10-12',
  months: [{ month: '2026-10', income: '80000000', expenses: '24000000' }],
  unconvertedShareCount: 2,
  unconvertedInstallmentCount: 1,
};

const netWorth = {
  currency: 'USD',
  from: '2026-06-30',
  to: '2026-10-12',
  points: [
    {
      date: '2026-10-12',
      ars: '100',
      usd: '1',
      total: null,
      reason: 'no_rate',
      investmentsIncomplete: true,
    },
  ],
};

function jsonResponse(status: number, body: unknown): Response {
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

describe('reports api client', () => {
  it('the category call sends tag=vacations2026 and parses the answer (AC-26)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, categories));

    const result = await client.getExpensesByCategory({ tag: 'vacations2026' });

    expect(fetch.mock.calls[0]?.[0]).toBe(
      `${BASE_URL}/reports/expenses-by-category?tag=vacations2026`,
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', credentials: 'include' });
    expect(result).toEqual({ ok: true, data: categories });
  });

  it('sends only the defined keys, and no query string when none is defined', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, categories),
      jsonResponse(200, categories),
      jsonResponse(200, incomeExpenses),
    );

    await client.getExpensesByCategory({});
    await client.getExpensesByCategory({ from: '2026-08-01', to: undefined, accountId: ID });
    await client.getIncomeExpenses({ from: '2025-11-01', to: '2026-10-12' });

    expect(fetch.mock.calls[0]?.[0]).toBe(`${BASE_URL}/reports/expenses-by-category`);
    expect(fetch.mock.calls[1]?.[0]).toBe(
      `${BASE_URL}/reports/expenses-by-category?from=2026-08-01&accountId=${ID}`,
    );
    expect(fetch.mock.calls[2]?.[0]).toBe(
      `${BASE_URL}/reports/income-expenses?from=2025-11-01&to=2026-10-12`,
    );
  });

  it('net worth with no query is unchanged and with a query sends only from and to', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, netWorth),
      jsonResponse(200, netWorth),
      jsonResponse(200, netWorth),
    );

    const plain = await client.getNetWorthSeries();
    await client.getNetWorthSeries({ from: '2026-06-01', to: '2026-10-12' });
    // A caller that spreads the flow filters must not leak the entity filters into net worth.
    await client.getNetWorthSeries({ from: '2026-06-01', tag: 'x' } as never);

    expect(plain).toEqual({ ok: true, data: netWorth });
    expect(fetch.mock.calls[0]?.[0]).toBe(`${BASE_URL}/reports/net-worth`);
    expect(fetch.mock.calls[1]?.[0]).toBe(
      `${BASE_URL}/reports/net-worth?from=2026-06-01&to=2026-10-12`,
    );
    expect(fetch.mock.calls[2]?.[0]).toBe(`${BASE_URL}/reports/net-worth?from=2026-06-01`);
  });

  it('tries to refresh the session on a 401 (refreshOnUnauthenticated)', async () => {
    const unauthenticated = () => jsonResponse(401, { code: 'UNAUTHENTICATED' });
    const { client, fetch } = clientWith(unauthenticated(), unauthenticated(), unauthenticated());

    const result = await client.getIncomeExpenses({});

    expect(fetch.mock.calls[2]?.[0]).toBe(`${BASE_URL}/auth/refresh`);
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
  });

  it('error: a body that fails the shared response definition is a failure, never partial data', async () => {
    const bad = { ...categories, total: '12.5' };
    const { client } = clientWith(
      jsonResponse(200, bad),
      jsonResponse(200, {
        ...incomeExpenses,
        months: [{ month: '2026-13', income: '1', expenses: '1' }],
      }),
      jsonResponse(200, { ...netWorth, points: [{ ...netWorth.points[0], reason: null }] }),
    );

    for (const result of [
      await client.getExpensesByCategory({}),
      await client.getIncomeExpenses({}),
      await client.getNetWorthSeries(),
    ]) {
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty('data');
    }
  });

  it('error: a rejected answer or a network failure is a failure result', async () => {
    const { client } = clientWith(
      jsonResponse(404, { code: 'NOT_FOUND' }),
      jsonResponse(400, { code: 'VALIDATION_FAILED', fields: ['query.to'] }),
    );
    expect(await client.getExpensesByCategory({ accountId: ID })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(await client.getIncomeExpenses({ to: '2099-01-01' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
      fields: ['query.to'],
    });

    const offline = createApiClient({
      baseUrl: BASE_URL,
      fetch: () => Promise.reject(new TypeError('offline')),
    });
    expect(await offline.getNetWorthSeries({ from: '2026-01-01' })).toMatchObject({
      ok: false,
      code: 'NETWORK',
    });
  });
});
