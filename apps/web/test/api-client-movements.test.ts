import { ERROR_CODES } from '@pesly/shared';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';
const ACCOUNT_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const CATEGORY_ID = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';

const MOVEMENT = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'expense',
  accountId: ACCOUNT_ID,
  categoryId: CATEGORY_ID,
  destinationAccountId: null,
  amount: '150050',
  destinationAmount: null,
  occurredAt: '2026-10-02T15:30:00.000Z',
  note: null,
  rate: '12505000',
  rateSource: 'automatic',
  rateType: 'blue',
  createdAt: '2026-10-02T15:31:00.000Z',
  tags: [],
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
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

describe('api client: movements (DISC-001-03b Block 8)', () => {
  it('createMovement posts the body to /movements and parses the movement', async () => {
    const { client, fetch } = clientWith(jsonResponse(201, MOVEMENT));
    const body = {
      type: 'expense',
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      amount: '150050',
      occurredAt: '2026-10-02T15:30:00.000Z',
      rate: { source: 'automatic' },
    } as const;

    const result = await client.createMovement(body);

    expect(result).toEqual({ ok: true, data: MOVEMENT });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/movements`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it('createMovement posts a transfer and an exchange and parses their nullable response fields (AC-01, AC-05)', async () => {
    const DESTINATION_ID = '22222222-2222-4222-8222-222222222222';
    const transfer = {
      ...MOVEMENT,
      type: 'transfer',
      categoryId: null,
      destinationAccountId: DESTINATION_ID,
      destinationAmount: '150050',
      rate: null,
      rateSource: null,
      rateType: null,
    };
    const exchange = {
      ...transfer,
      type: 'exchange',
      destinationAmount: '100000',
      rate: '15573000',
      rateSource: 'implied',
    };
    const { client, fetch } = clientWith(jsonResponse(201, transfer), jsonResponse(201, exchange));
    const occurredAt = '2026-10-02T15:30:00.000Z';

    const first = await client.createMovement({
      type: 'transfer',
      accountId: ACCOUNT_ID,
      destinationAccountId: DESTINATION_ID,
      amount: '150050',
      occurredAt,
    });
    const second = await client.createMovement({
      type: 'exchange',
      accountId: ACCOUNT_ID,
      destinationAccountId: DESTINATION_ID,
      amount: '155730000',
      destinationAmount: '100000',
      occurredAt,
    });

    expect(first).toEqual({ ok: true, data: transfer });
    expect(second).toEqual({ ok: true, data: exchange });
    expect(JSON.parse(requestAt(fetch, 1).init.body as string)).toEqual({
      type: 'exchange',
      accountId: ACCOUNT_ID,
      destinationAccountId: DESTINATION_ID,
      amount: '155730000',
      destinationAmount: '100000',
      occurredAt,
    });
  });

  it('listMovements sends limit and offset and parses the page', async () => {
    const page = { items: [MOVEMENT], total: 1, limit: 100, offset: 0 };
    const { client, fetch } = clientWith(jsonResponse(200, page), jsonResponse(200, page));

    expect(await client.listMovements({ limit: 100, offset: 200 })).toEqual({
      ok: true,
      data: page,
    });
    await client.listMovements({});

    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/movements?limit=100&offset=200`);
    expect(requestAt(fetch, 1).url).toBe(`${BASE_URL}/movements`);
    expect(requestAt(fetch, 0).init.method).toBe('GET');
  });

  it('createMovement sends the tags in the body (AC-03)', async () => {
    const { client, fetch } = clientWith(jsonResponse(201, { ...MOVEMENT, tags: ['Viaje'] }));

    const result = await client.createMovement({
      type: 'expense',
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      amount: '1',
      occurredAt: '2026-10-02T15:30:00.000Z',
      rate: { source: 'automatic' },
      tags: ['Viaje'],
    });

    expect(result).toMatchObject({ ok: true, data: { tags: ['Viaje'] } });
    expect(JSON.parse(requestAt(fetch, 0).init.body as string)).toMatchObject({ tags: ['Viaje'] });
  });

  it('createMovement rejects an answer without tags as a malformed response (error path)', async () => {
    const withoutTags: Record<string, unknown> = { ...MOVEMENT };
    delete withoutTags.tags;
    const { client } = clientWith(jsonResponse(201, withoutTags));

    const result = await client.createMovement({
      type: 'expense',
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      amount: '1',
      occurredAt: '2026-10-02T15:30:00.000Z',
      rate: { source: 'automatic' },
    });

    expect(result.ok).toBe(false);
  });

  it('listMovements forwards every provided filter and omits the undefined ones (AC-01)', async () => {
    const page = { items: [], total: 0, limit: 20, offset: 0 };
    const { client, fetch } = clientWith(jsonResponse(200, page), jsonResponse(200, page));

    await client.listMovements({
      limit: 20,
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      from: '2026-10-01',
      to: '2026-10-31',
      type: 'income',
      tag: 'Viaje a Brasil',
      offset: undefined,
    });
    await client.listMovements({ tag: undefined, type: undefined });

    const url = new URL(requestAt(fetch, 0).url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '20',
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      from: '2026-10-01',
      to: '2026-10-31',
      type: 'income',
      tag: 'Viaje a Brasil',
    });
    expect(requestAt(fetch, 1).url).toBe(`${BASE_URL}/movements`);
  });

  it('listTags reads /tags with the prefix and limit and parses the items (AC-05)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, { items: ['Viaje'] }));

    const result = await client.listTags({ prefix: 'vi&a', limit: 10 });

    expect(result).toEqual({ ok: true, data: { items: ['Viaje'] } });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/tags?prefix=vi%26a&limit=10`);
    expect(init.method).toBe('GET');
  });

  it('listTags omits the limit when none is given and maps failures (error path)', async () => {
    const refused = () => jsonResponse(401, { code: 'UNAUTHENTICATED' });
    const { client, fetch } = clientWith(
      jsonResponse(200, { items: [] }),
      refused(),
      refused(),
      refused(),
    );

    await client.listTags({ prefix: 'a' });
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/tags?prefix=a`);
    expect(await client.listTags({ prefix: 'a' })).toMatchObject({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(fetch.mock.calls.map(([url]) => url)[3]).toBe(`${BASE_URL}/auth/refresh`);
  });

  it('getLatestRates reads /exchange-rates/latest', async () => {
    const rates = {
      rates: [
        {
          rateType: 'blue',
          buy: '12000000',
          sell: '12505000',
          providerUpdatedAt: '2026-10-02T10:00:00.000Z',
          fetchedAt: '2026-10-02T10:05:00.000Z',
        },
      ],
    };
    const { client, fetch } = clientWith(jsonResponse(200, rates));

    expect(await client.getLatestRates()).toEqual({ ok: true, data: rates });
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/exchange-rates/latest`);
  });

  it.each([
    [
      'createMovement',
      (c: ReturnType<typeof clientWith>['client']) =>
        c.createMovement({
          type: 'expense',
          accountId: ACCOUNT_ID,
          categoryId: CATEGORY_ID,
          amount: '1',
          occurredAt: '2026-10-02T15:30:00.000Z',
          rate: { source: 'automatic' },
        }),
    ],
    ['listMovements', (c: ReturnType<typeof clientWith>['client']) => c.listMovements({})],
    ['getLatestRates', (c: ReturnType<typeof clientWith>['client']) => c.getLatestRates()],
  ])('%s refreshes the session once when refused', async (_name, call) => {
    const refused = () => jsonResponse(401, { code: 'UNAUTHENTICATED' });
    const { client, fetch } = clientWith(refused(), refused(), refused());

    expect(await call(client)).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    const urls = fetch.mock.calls.map(([url]) => url);
    expect(urls).toHaveLength(3);
    expect(urls[2]).toBe(`${BASE_URL}/auth/refresh`);
  });

  it.each([
    [400, 'MOVEMENT_DATE_IN_FUTURE', 'movementDateInFuture'],
    [400, 'RATE_REQUIRED', 'rateRequired'],
    [400, 'MOVEMENT_CATEGORY_KIND_MISMATCH', 'movementCategoryKindMismatch'],
    [409, 'CATEGORY_ARCHIVED', 'categoryArchived'],
    [409, 'ACCOUNT_ARCHIVED', 'accountArchived'],
    [400, 'MOVEMENT_SAME_ACCOUNT', 'movementSameAccount'],
    [400, 'MOVEMENT_CURRENCY_MISMATCH', 'movementCurrencyMismatch'],
    [400, 'EXCHANGE_SAME_CURRENCY', 'exchangeSameCurrency'],
    [400, 'IMPLIED_RATE_OUT_OF_RANGE', 'impliedRateOutOfRange'],
  ] as const)('maps %i %s to the message key %s', async (status, code, messageKey) => {
    const { client } = clientWith(jsonResponse(status, { code }));

    const result = await client.listMovements({});

    expect(result).toEqual({ ok: false, code, messageKey });
  });

  it('reads retryAfterSeconds from the Retry-After header of a 429 (error path)', async () => {
    const { client } = clientWith(
      jsonResponse(429, { code: 'RATE_LIMITED' }, { 'Retry-After': '42' }),
    );

    const result = await client.listMovements({});

    expect(result).toEqual({
      ok: false,
      code: 'RATE_LIMITED',
      messageKey: 'retryLater',
      retryAfterSeconds: 42,
    });
  });

  it.each(['', 'soon', '-3', '0', '1.5', 'Wed, 21 Oct 2026 07:28:00 GMT'])(
    'ignores a Retry-After of %j that is not a positive whole number of seconds (invalid input)',
    async (value) => {
      const { client } = clientWith(
        jsonResponse(429, { code: 'RATE_LIMITED' }, { 'Retry-After': value }),
      );

      const result = await client.listMovements({});

      expect(result).toEqual({ ok: false, code: 'RATE_LIMITED', messageKey: 'retryLater' });
    },
  );

  it('leaves retryAfterSeconds out when the header is missing', async () => {
    const { client } = clientWith(jsonResponse(429, { code: 'RATE_LIMITED' }));

    expect(await client.listMovements({})).not.toHaveProperty('retryAfterSeconds');
  });

  it('answers a message key for every error code the API can send', async () => {
    for (const code of ERROR_CODES) {
      // A session refusal triggers a refresh and a retry, so every call gets its own response.
      const client = createApiClient({
        baseUrl: BASE_URL,
        fetch: () => Promise.resolve(jsonResponse(400, { code })),
      });
      const result = await client.listMovements({});
      expect(result).toMatchObject({ ok: false, code });
      expect(result.ok ? '' : result.messageKey).not.toBe('');
    }
  });
});

describe('api client: edit and delete movements (DISC-001-03e Block 6)', () => {
  it('getMovement gets /movements/:id and parses the movement (AC-01)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, MOVEMENT));

    const result = await client.getMovement(MOVEMENT.id);

    expect(result).toEqual({ ok: true, data: MOVEMENT });
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/movements/${MOVEMENT.id}`);
    expect(requestAt(fetch, 0).init.method).toBe('GET');
  });

  it('updateMovement puts the body to /movements/:id and parses the movement (AC-01)', async () => {
    const edited = { ...MOVEMENT, amount: '9000', note: 'fixed' };
    const { client, fetch } = clientWith(jsonResponse(200, edited));
    const body = {
      type: 'expense',
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      amount: '9000',
      occurredAt: '2026-10-02T15:30:00.000Z',
      note: 'fixed',
      rate: { source: 'keep' },
    } as const;

    const result = await client.updateMovement(MOVEMENT.id, body);

    expect(result).toEqual({ ok: true, data: edited });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/movements/${MOVEMENT.id}`);
    expect(init.method).toBe('PUT');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it('deleteMovement sends DELETE to /movements/:id and resolves on 204 (AC-02)', async () => {
    const { client, fetch } = clientWith(new Response(null, { status: 204 }));

    const result = await client.deleteMovement(MOVEMENT.id);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/movements/${MOVEMENT.id}`);
    expect(requestAt(fetch, 0).init.method).toBe('DELETE');
  });

  it('maps a future date and an immutable type error of updateMovement to their message keys (FR-04)', async () => {
    const { client } = clientWith(
      jsonResponse(400, { code: 'MOVEMENT_DATE_IN_FUTURE' }),
      jsonResponse(409, { code: 'MOVEMENT_TYPE_IMMUTABLE' }),
    );
    const body = {
      type: 'expense',
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      amount: '9000',
      occurredAt: '2026-10-02T15:30:00.000Z',
      rate: { source: 'automatic' },
    } as const;

    expect(await client.updateMovement(MOVEMENT.id, body)).toMatchObject({
      ok: false,
      code: 'MOVEMENT_DATE_IN_FUTURE',
      messageKey: 'movementDateInFuture',
    });
    expect(await client.updateMovement(MOVEMENT.id, body)).toMatchObject({
      ok: false,
      code: 'MOVEMENT_TYPE_IMMUTABLE',
      messageKey: 'movementTypeImmutable',
    });
  });

  it('a 404 from deleteMovement is a failed result, not an exception (AC-03)', async () => {
    const { client } = clientWith(jsonResponse(404, { code: 'NOT_FOUND' }));

    const result = await client.deleteMovement(MOVEMENT.id);

    expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND', messageKey: 'unexpected' });
  });

  it('refuses an id that is not a plain path segment without calling the network (error path)', async () => {
    const { client, fetch } = clientWith();

    for (const id of ['', '.', '..']) {
      expect(await client.getMovement(id)).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
      expect(await client.deleteMovement(id)).toMatchObject({
        ok: false,
        code: 'VALIDATION_FAILED',
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
