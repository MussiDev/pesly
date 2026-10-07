import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';
const CARD_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const STATEMENT_ID = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';

const card = {
  id: CARD_ID,
  name: 'Visa',
  closingDay: 24,
  dueDay: 5,
  arsAccountId: '11111111-1111-4111-8111-111111111111',
  usdAccountId: '22222222-2222-4222-8222-222222222222',
  createdAt: '2026-10-06T12:00:00.000Z',
};

const statement = {
  id: STATEMENT_ID,
  cardId: CARD_ID,
  period: '2026-10',
  closingDate: '2026-10-24',
  dueDate: '2026-11-05',
  status: 'open',
  totals: { ARS: '0', USD: '0' },
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

function requestAt(fetch: ReturnType<typeof clientWith>['fetch'], index: number) {
  const call = fetch.mock.calls[index];
  if (!call) throw new Error(`no fetch call #${index}`);
  const [url, init] = call;
  return { url, init: init ?? {} };
}

describe('credit cards api client', () => {
  it('listCreditCards and getCreditCard read the cards (AC-01, AC-11)', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, { items: [card] }),
      jsonResponse(200, card),
    );

    expect(await client.listCreditCards()).toEqual({ ok: true, data: { items: [card] } });
    expect(await client.getCreditCard(CARD_ID)).toEqual({ ok: true, data: card });
    expect(requestAt(fetch, 0)).toMatchObject({
      url: `${BASE_URL}/credit-cards`,
      init: { method: 'GET', credentials: 'include' },
    });
    expect(requestAt(fetch, 1).url).toBe(`${BASE_URL}/credit-cards/${CARD_ID}`);
  });

  it('createCreditCard posts the name and days with the origin header (FR-01)', async () => {
    const { client, fetch } = clientWith(jsonResponse(201, card));

    const result = await client.createCreditCard({ name: 'Visa', closingDay: 24, dueDay: 5 });

    expect(result).toEqual({ ok: true, data: card });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/credit-cards`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Visa', closingDay: 24, dueDay: 5 });
    expect(new Headers(init.headers).get('X-Requested-With')).toBe('argent');
  });

  it('updateCreditCardDays patches the days (FR-06)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, { ...card, closingDay: 20 }));

    const result = await client.updateCreditCardDays(CARD_ID, { closingDay: 20 });

    expect(result).toMatchObject({ ok: true, data: { closingDay: 20 } });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/credit-cards/${CARD_ID}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ closingDay: 20 });
  });

  it('deleteCreditCard sends DELETE and accepts 204 (FR-08)', async () => {
    const { client, fetch } = clientWith(new Response(null, { status: 204 }));

    expect(await client.deleteCreditCard(CARD_ID)).toEqual({ ok: true, data: undefined });
    expect(requestAt(fetch, 0)).toMatchObject({
      url: `${BASE_URL}/credit-cards/${CARD_ID}`,
      init: { method: 'DELETE' },
    });
  });

  it('listStatements and updateStatement read and move the dates (FR-03, FR-05)', async () => {
    const moved = { ...statement, closingDate: '2026-10-26' };
    const { client, fetch } = clientWith(
      jsonResponse(200, { items: [statement] }),
      jsonResponse(200, moved),
    );

    expect(await client.listStatements(CARD_ID)).toEqual({
      ok: true,
      data: { items: [statement] },
    });
    expect(
      await client.updateStatement(CARD_ID, STATEMENT_ID, { closingDate: '2026-10-26' }),
    ).toEqual({ ok: true, data: moved });
    expect(requestAt(fetch, 0).url).toBe(`${BASE_URL}/credit-cards/${CARD_ID}/statements`);
    const { url, init } = requestAt(fetch, 1);
    expect(url).toBe(`${BASE_URL}/credit-cards/${CARD_ID}/statements/${STATEMENT_ID}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ closingDate: '2026-10-26' });
  });

  it.each([
    ['STATEMENT_CLOSED', 'statementClosed'],
    ['CARD_HAS_MOVEMENTS', 'cardHasMovements'],
    ['ACCOUNT_NAME_TAKEN', 'accountNameTaken'],
    ['ACCOUNT_LINKED_TO_CARD', 'accountLinkedToCard'],
  ])('maps a 409 %s to its message key (sad path)', async (code, messageKey) => {
    const { client } = clientWith(jsonResponse(409, { code }));
    expect(await client.deleteCreditCard(CARD_ID)).toEqual({ ok: false, code, messageKey });
  });

  it('refuses an id of ".." without sending a request (invalid input, FR-08)', async () => {
    const { client, fetch } = clientWith();
    expect(await client.getCreditCard('..')).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(await client.listStatements('.')).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(await client.updateStatement(CARD_ID, '..', { dueDate: '2026-11-06' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps a success body that breaks the contract to unexpected (error path)', async () => {
    const { client } = clientWith(jsonResponse(200, { items: [{ id: 'x' }] }));
    expect(await client.listStatements(CARD_ID)).toMatchObject({
      ok: false,
      code: 'INTERNAL',
      messageKey: 'unexpected',
    });
  });

  it('createCardExpense posts the expense to the card route and parses the answer (FR-01)', async () => {
    const answer = {
      movementId: '5a1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b',
      accountId: card.usdAccountId,
      currency: 'USD',
      amount: '1599',
      occurredAt: '2026-10-05T15:00:00.000Z',
      statementId: STATEMENT_ID,
    };
    const { client, fetch } = clientWith(jsonResponse(201, answer));
    const body = {
      currency: 'USD' as const,
      categoryId: '00000000-0000-4000-8000-000000000011',
      amount: '1599',
      occurredAt: '2026-10-05T15:00:00.000Z',
      rate: { source: 'automatic' as const },
    };

    expect(await client.createCardExpense(CARD_ID, body)).toEqual({ ok: true, data: answer });
    const { url, init } = requestAt(fetch, 0);
    expect(url).toBe(`${BASE_URL}/credit-cards/${CARD_ID}/expenses`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(new Headers(init.headers).get('X-Requested-With')).toBe('argent');
  });

  it('createCardExpense maps a malformed success body to unexpected and refuses ".." (error path)', async () => {
    const { client, fetch } = clientWith(jsonResponse(201, { movementId: 1 }));
    const body = {
      currency: 'ARS' as const,
      categoryId: '00000000-0000-4000-8000-000000000011',
      amount: '100',
      occurredAt: '2026-10-05T15:00:00.000Z',
      rate: { source: 'automatic' as const },
    };
    expect(await client.createCardExpense(CARD_ID, body)).toMatchObject({
      ok: false,
      code: 'INTERNAL',
      messageKey: 'unexpected',
    });
    expect(await client.createCardExpense('..', body)).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
