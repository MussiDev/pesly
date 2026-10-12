import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';
const ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';

const PARTS = {
  accounts: { ars: '100000000', usd: '100000' },
  investments: { ars: '0', usd: '0' },
  groups: { ars: '0', usd: '0' },
  installmentDebt: { ars: '0', usd: '0' },
};

// A body in the shape of spec DISC-001-09b.
const dashboard = {
  currency: 'ARS',
  today: '2026-10-12',
  netWorth: {
    ars: '100000000',
    usd: '100000',
    total: '142000000',
    reason: null,
    holdingsWithoutPrice: 0,
    parts: PARTS,
  },
  month: {
    from: '2026-10-01',
    to: '2026-10-12',
    expenses: '24000000',
    income: '80000000',
    net: '56000000',
    change: { expenses: 20, income: null, net: -5 },
    unconvertedShareCount: 1,
    unconvertedInstallmentCount: 2,
  },
  categories: [
    { categoryId: null, defaultKey: 'food', name: null, amount: '12000000', sharePercent: 60 },
  ],
  budgets: [
    {
      budgetId: ID,
      name: 'Food',
      currency: 'ARS',
      available: '2000000',
      spent: '8000000',
      percentUsed: 80,
      status: 'close',
    },
  ],
  upcoming: [
    {
      kind: 'recurring_payment',
      paymentId: ID,
      date: '2026-10-15',
      name: 'Rent',
      currency: 'ARS',
      amount: '35000000',
    },
  ],
  actions: [{ kind: 'overdue_occurrence', dueDate: '2026-10-01', name: 'Gym', occurrenceId: ID }],
  groups: { owedToYou: { ars: '3000000', usd: '0' }, youOwe: { ars: '0', usd: '5000' } },
  insight: {
    categoryId: null,
    defaultKey: 'food',
    name: null,
    amount: '12000000',
    sharePercent: 32,
    changePercent: 40,
  },
  firstSteps: { hasAccount: true, hasMovement: true, show: false },
};

const series = {
  currency: 'ARS',
  from: '2025-11-30',
  to: '2026-10-12',
  points: [
    {
      date: '2026-10-12',
      ars: '100',
      usd: '1',
      total: '200',
      reason: null,
      investmentsIncomplete: false,
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

describe('dashboard api client', () => {
  it('getDashboard sends one request to /dashboard with no query (AC-37)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, dashboard));

    const result = await client.getDashboard();

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE_URL}/dashboard`);
    expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
    if (result.ok) expect(result.data.netWorth.total).toBe('142000000');
  });

  it('getNetWorthSeries sends one request to /reports/net-worth with no query (AC-37, AC-10)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, series));

    const result = await client.getNetWorthSeries();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(`${BASE_URL}/reports/net-worth`);
    expect(result).toEqual({ ok: true, data: series });
  });

  it('keeps the network failure and the 401 as their own kinds (AC-03, AC-36)', async () => {
    const offline = createApiClient({
      baseUrl: BASE_URL,
      fetch: () => Promise.reject(new TypeError('offline')),
    });
    expect(await offline.getDashboard()).toMatchObject({
      ok: false,
      code: 'NETWORK',
      messageKey: 'network',
    });

    const denied = () => jsonResponse(401, { code: 'UNAUTHENTICATED', message: 'no' });
    const { client } = clientWith(denied(), denied(), denied());
    expect(await client.getNetWorthSeries()).toMatchObject({
      ok: false,
      code: 'UNAUTHENTICATED',
      messageKey: 'unauthenticated',
    });
  });

  it('a 500 keeps the unexpected key', async () => {
    const { client } = clientWith(jsonResponse(500, { code: 'INTERNAL', message: 'x' }));
    expect(await client.getDashboard()).toMatchObject({ ok: false, messageKey: 'unexpected' });
  });

  it.each([
    ['a decimal amount', { netWorth: { ...dashboard.netWorth, total: '12.5' } }],
    ['an unknown budget status', { budgets: [{ ...dashboard.budgets[0], status: 'fine' }] }],
    ['an id that is not a UUID', { budgets: [{ ...dashboard.budgets[0], budgetId: 'abc' }] }],
    ['a fractional percent', { categories: [{ ...dashboard.categories[0], sharePercent: 60.5 }] }],
    ['an unknown action kind', { actions: [{ ...dashboard.actions[0], kind: 'nope' }] }],
    ['a missing today', { today: undefined }],
    ['an unknown currency', { currency: 'EUR' }],
  ])('rejects %s as a generic failure with no view', async (_name, patch) => {
    const { client } = clientWith(jsonResponse(200, { ...dashboard, ...patch }));
    expect(await client.getDashboard()).toMatchObject({ ok: false, messageKey: 'unexpected' });
  });

  it('rejects a body with a missing section', async () => {
    const incomplete: Record<string, unknown> = { ...dashboard };
    delete incomplete.categories;
    const { client } = clientWith(jsonResponse(200, incomplete));
    expect(await client.getDashboard()).toMatchObject({ ok: false, messageKey: 'unexpected' });
  });

  it('ignores unknown extra fields', async () => {
    const { client } = clientWith(jsonResponse(200, { ...dashboard, extra: 1 }));
    expect((await client.getDashboard()).ok).toBe(true);
  });
});
