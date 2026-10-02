import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';
const PORTFOLIO_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const HOLDING_ID = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';

const holding = {
  id: HOLDING_ID,
  portfolioId: PORTFOLIO_ID,
  ticker: 'AAPL',
  instrumentName: 'Apple',
  instrumentType: 'cedear',
  quantity: '1050000000',
  valuationCurrency: 'ARS',
  totalCost: '1850000',
  unitPrice: null,
  priceSource: null,
  pricedAt: null,
  priceStale: false,
  marketUnitPrice: null,
  marketPricedAt: null,
  marketPriceDiffers: false,
  marketPriceRecent: false,
  value: null,
  gain: null,
};

const portfolio = {
  id: PORTFOLIO_ID,
  name: 'Broker',
  createdAt: '2026-03-01T01:30:00.000Z',
  totals: [],
  holdingsWithoutPrice: 1,
  holdings: [holding],
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

function expectGuarded(init: RequestInit) {
  expect(init.credentials).toBe('include');
  expect(new Headers(init.headers).get('X-Requested-With')).toBe('argent');
}

describe('investments api client', () => {
  it('listPortfolios parses the list and sends credentials (AC-16)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, { portfolios: [portfolio] }));

    const result = await client.listPortfolios();

    expect(result).toEqual({ ok: true, data: { portfolios: [portfolio] } });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/investments/portfolios`);
    expect(init.method).toBe('GET');
    expectGuarded(init);
  });

  it('a list that breaks the contract becomes INTERNAL (AC-16)', async () => {
    const { client } = clientWith(jsonResponse(200, { portfolios: [{ id: 'x' }] }));
    expect(await client.listPortfolios()).toMatchObject({ ok: false, code: 'INTERNAL' });
  });

  it('createPortfolio posts the name (AC-01)', async () => {
    const { client, fetch } = clientWith(jsonResponse(201, portfolio));

    const result = await client.createPortfolio({ name: 'Broker' });

    expect(result.ok).toBe(true);
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/investments/portfolios`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Broker' });
    expectGuarded(init);
  });

  it('deletePortfolio sends DELETE and accepts 204 (AC-17)', async () => {
    const { client, fetch } = clientWith(new Response(null, { status: 204 }));

    const result = await client.deletePortfolio(PORTFOLIO_ID);

    expect(result).toEqual({ ok: true, data: undefined });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/investments/portfolios/${PORTFOLIO_ID}`);
    expect(init.method).toBe('DELETE');
    expectGuarded(init);
  });

  it('addHolding posts to the portfolio and exposes merged (AC-02, AC-05)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, { holding, merged: true }));

    const result = await client.addHolding(PORTFOLIO_ID, {
      ticker: 'AAPL',
      instrumentName: 'Apple',
      instrumentType: 'cedear',
      quantity: '1050000000',
      valuationCurrency: 'ARS',
    });

    expect(result).toEqual({ ok: true, data: { holding, merged: true } });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/investments/portfolios/${PORTFOLIO_ID}/holdings`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      ticker: 'AAPL',
      instrumentName: 'Apple',
      instrumentType: 'cedear',
      quantity: '1050000000',
      valuationCurrency: 'ARS',
    });
    expectGuarded(init);
  });

  it('addHolding exposes merged false on a 201 (AC-02)', async () => {
    const { client } = clientWith(jsonResponse(201, { holding, merged: false }));

    const result = await client.addHolding(PORTFOLIO_ID, {
      ticker: 'AAPL',
      instrumentName: 'Apple',
      instrumentType: 'cedear',
      quantity: '1050000000',
      valuationCurrency: 'ARS',
    });

    expect(result).toEqual({ ok: true, data: { holding, merged: false } });
  });

  it('URL-encodes ids placed in the path (AC-06)', async () => {
    const { client, fetch } = clientWith(new Response(null, { status: 204 }));

    await client.deleteHolding('a/b?x');

    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/investments/holdings/a%2Fb%3Fx`);
  });

  it('updateHolding patches the holding (AC-07)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, holding));

    const result = await client.updateHolding(HOLDING_ID, { quantity: '5' });

    expect(result).toEqual({ ok: true, data: holding });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/investments/holdings/${HOLDING_ID}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ quantity: '5' });
    expectGuarded(init);
  });

  it('setHoldingPrice puts the unit price (AC-10)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, holding));

    const result = await client.setHoldingPrice(HOLDING_ID, { unitPrice: '1850000' });

    expect(result.ok).toBe(true);
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/investments/holdings/${HOLDING_ID}/price`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ unitPrice: '1850000' });
    expectGuarded(init);
  });

  it('deleteHolding sends DELETE and accepts 204 (AC-06)', async () => {
    const { client, fetch } = clientWith(new Response(null, { status: 204 }));

    const result = await client.deleteHolding(HOLDING_ID);

    expect(result).toEqual({ ok: true, data: undefined });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/investments/holdings/${HOLDING_ID}`);
    expect(init.method).toBe('DELETE');
    expectGuarded(init);
  });

  it('a 400 exposes the invalid fields (AC-24)', async () => {
    const { client } = clientWith(
      jsonResponse(400, { code: 'VALIDATION_FAILED', fields: ['quantity'] }),
    );

    const result = await client.updateHolding(HOLDING_ID, { quantity: '5' });

    expect(result).toEqual({
      ok: false,
      code: 'VALIDATION_FAILED',
      messageKey: 'validationFailed',
      fields: ['quantity'],
    });
  });

  it('omits fields when the error body has none (AC-15)', async () => {
    const { client } = clientWith(jsonResponse(404, { code: 'NOT_FOUND' }));

    const result = await client.deleteHolding(HOLDING_ID);

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND', messageKey: 'unexpected' });
    expect('fields' in result).toBe(false);
  });

  it('maps a network error to NETWORK (AC-15)', async () => {
    const { client } = clientWith(new TypeError('failed to fetch'));
    expect(await client.listPortfolios()).toEqual({
      ok: false,
      code: 'NETWORK',
      messageKey: 'network',
    });
  });

  it('refreshes the session once when the access token is refused', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(401, { code: 'UNAUTHENTICATED' }),
      jsonResponse(401, { code: 'UNAUTHENTICATED' }),
      jsonResponse(200, { status: 'refreshed' }),
      jsonResponse(200, { portfolios: [] }),
    );

    const result = await client.listPortfolios();

    expect(result.ok).toBe(true);
    expect(requestAt(fetch, 2).url).toBe(`${BASE_URL}/auth/refresh`);
  });
});
