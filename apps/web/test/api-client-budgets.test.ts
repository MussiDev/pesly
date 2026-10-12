import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';
const BUDGET_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const CATEGORY_ID = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';

const budget = {
  id: BUDGET_ID,
  name: 'Food',
  amount: '100000',
  currency: 'ARS',
  rollover: false,
  thresholds: [80, 100],
  categoryIds: [CATEGORY_ID],
  coveredCategoryIds: [CATEGORY_ID],
  effectiveFrom: '2026-10-01',
  createdAt: '2026-10-06T12:00:00.000Z',
};

const spending = {
  budgetId: BUDGET_ID,
  name: 'Food',
  currency: 'ARS',
  month: '2026-10',
  amount: '100000',
  rolloverEnabled: false,
  rolloverAmount: '0',
  available: '100000',
  spent: '25000',
  remaining: '75000',
  percentUsed: 25,
  thresholds: [80, 100],
  unconvertedShareCount: 0,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientWith(...responses: (Response | Error)[]) {
  const queue = [...responses];
  const fetch = vi.fn<FetchLike>(() => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch call');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { client: createApiClient({ baseUrl: BASE_URL, fetch }), fetch };
}

function requestAt(fetch: ReturnType<typeof clientWith>['fetch'], index: number) {
  const call = fetch.mock.calls[index];
  if (!call) throw new Error(`no fetch call #${index}`);
  const [url, init] = call;
  return { url, init: init ?? {} };
}

describe('budgets api client', () => {
  it('listBudgetSpending sends no month by default, sends a given month and returns the budgets (AC-01, AC-07)', async () => {
    const list = { month: '2026-10', budgets: [spending] };
    const { client, fetch } = clientWith(
      jsonResponse(200, list),
      jsonResponse(200, { ...list, month: '2026-09' }),
    );

    expect(await client.listBudgetSpending({})).toEqual({ ok: true, data: list });
    expect(await client.listBudgetSpending({ month: '2026-09' })).toMatchObject({ ok: true });
    expect(requestAt(fetch, 0)).toMatchObject({
      url: `${BASE_URL}/budgets/spending`,
      init: { method: 'GET', credentials: 'include' },
    });
    expect(requestAt(fetch, 1).url).toBe(`${BASE_URL}/budgets/spending?month=2026-09`);
  });

  it('getBudget returns the budget and a 404 is the not found failure (AC-12)', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, budget),
      jsonResponse(404, { code: 'NOT_FOUND' }),
    );

    expect(await client.getBudget(BUDGET_ID)).toEqual({ ok: true, data: budget });
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/budgets/${BUDGET_ID}`);
    expect(await client.getBudget(BUDGET_ID)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('getBudgetSpending sends the month and returns the figures (AC-11)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, spending), jsonResponse(200, spending));

    expect(await client.getBudgetSpending(BUDGET_ID, { month: '2026-10' })).toEqual({
      ok: true,
      data: spending,
    });
    expect(await client.getBudgetSpending(BUDGET_ID, {})).toMatchObject({ ok: true });
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/budgets/${BUDGET_ID}/spending?month=2026-10`);
    expect(requestAt(fetch, 1).url).toBe(`${BASE_URL}/budgets/${BUDGET_ID}/spending`);
  });

  it('createBudget sends the amount as a minor-units string and the thresholds (AC-15)', async () => {
    const { client, fetch } = clientWith(jsonResponse(201, budget));

    const result = await client.createBudget({
      name: 'Food',
      amount: '100000',
      currency: 'ARS',
      categoryIds: [CATEGORY_ID],
      thresholds: [50, 100],
    });

    expect(result).toEqual({ ok: true, data: budget });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/budgets`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Food',
      amount: '100000',
      currency: 'ARS',
      categoryIds: [CATEGORY_ID],
      thresholds: [50, 100],
    });
    expect(init.headers).toMatchObject({ 'X-Requested-With': 'argent' });
  });

  it('updateBudget sends only the given fields (AC-21)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, { ...budget, rollover: true }));

    const result = await client.updateBudget(BUDGET_ID, { rollover: true });

    expect(result.ok).toBe(true);
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/budgets/${BUDGET_ID}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ rollover: true });
  });

  it('deleteBudget resolves with no body (AC-24)', async () => {
    const { client, fetch } = clientWith(new Response(null, { status: 204 }));

    expect(await client.deleteBudget(BUDGET_ID)).toEqual({ ok: true, data: undefined });
    expect(requestAt(fetch, 0)).toMatchObject({
      url: `${BASE_URL}/budgets/${BUDGET_ID}`,
      init: { method: 'DELETE' },
    });
  });

  it('a refused 51st budget, an income category and a future month surface their own keys (AC-09, AC-27, AC-28)', async () => {
    const { client } = clientWith(
      jsonResponse(409, { code: 'BUDGET_LIMIT_REACHED' }),
      jsonResponse(400, { code: 'BUDGET_CATEGORY_KIND_INVALID' }),
      jsonResponse(400, { code: 'BUDGET_MONTH_IN_FUTURE' }),
    );

    expect(
      await client.createBudget({
        name: 'Food',
        amount: '1',
        currency: 'USD',
        categoryIds: [CATEGORY_ID],
      }),
    ).toMatchObject({ ok: false, messageKey: 'budgetLimitReached' });
    expect(await client.updateBudget(BUDGET_ID, { categoryIds: [CATEGORY_ID] })).toMatchObject({
      ok: false,
      messageKey: 'budgetCategoryKindInvalid',
    });
    expect(await client.getBudgetSpending(BUDGET_ID, { month: '2099-01' })).toMatchObject({
      ok: false,
      messageKey: 'budgetMonthInFuture',
    });
  });

  it('a network failure is the offline failure (AC-29)', async () => {
    const { client } = clientWith(new TypeError('Failed to fetch'));

    expect(await client.listBudgetSpending({})).toMatchObject({
      ok: false,
      code: 'NETWORK',
      messageKey: 'network',
    });
  });

  it('a malformed response body is a failure, not data', async () => {
    const { client } = clientWith(
      jsonResponse(200, { month: '2026-10', budgets: [{ ...spending, percentUsed: 'high' }] }),
      jsonResponse(200, { ...budget, thresholds: 'none' }),
      jsonResponse(200, { ...spending, spent: 12.5 }),
    );

    expect(await client.listBudgetSpending({})).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(await client.getBudget(BUDGET_ID)).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(await client.getBudgetSpending(BUDGET_ID, {})).toMatchObject({
      ok: false,
      code: 'INTERNAL',
    });
  });

  it('an invalid body or month is rejected before any request', async () => {
    const { client, fetch } = clientWith();
    const valid = {
      name: 'Food',
      amount: '100',
      currency: 'ARS' as const,
      categoryIds: [CATEGORY_ID],
    };

    expect(await client.createBudget({ ...valid, name: '' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(
      await client.createBudget({ ...valid, thresholds: [10, 20, 30, 40, 50, 60] }),
    ).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await client.createBudget({ ...valid, categoryIds: [] })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(await client.updateBudget(BUDGET_ID, {})).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(await client.listBudgetSpending({ month: '2026-13' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(await client.getBudgetSpending(BUDGET_ID, { month: 'october' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(await client.getBudget('..')).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
