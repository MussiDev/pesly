import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';
const ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const OCCURRENCE_ID = '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b';

const payment = {
  id: ID,
  name: 'Rent',
  amount: '35000000',
  accountId: '11111111-1111-4111-8111-111111111111',
  categoryId: '22222222-2222-4222-8222-222222222222',
  frequency: 'monthly',
  weekday: null,
  dayOfMonth: 5,
  month: null,
  startDate: '2026-10-05',
  endDate: null,
  mode: 'confirmation',
  status: 'active',
  nextDueDate: '2026-11-05',
};

const upcomingItem = {
  kind: 'pending',
  dueDate: '2026-10-05',
  paymentId: ID,
  name: 'Rent',
  amount: '35000000',
  accountId: payment.accountId,
  categoryId: payment.categoryId,
  occurrenceId: OCCURRENCE_ID,
};
const upcoming = { items: [upcomingItem] };

const createBody = {
  name: 'Rent',
  amount: '35000000',
  accountId: payment.accountId,
  categoryId: payment.categoryId,
  frequency: 'monthly' as const,
  dayOfMonth: 5,
  startDate: '2026-10-05',
  mode: 'confirmation' as const,
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

describe('recurring api client', () => {
  it('reads the list, one payment and the upcoming items (FR-01, AC-01)', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, { items: [payment] }),
      jsonResponse(200, payment),
      jsonResponse(200, upcoming),
    );

    expect(await client.listRecurringPayments()).toEqual({
      ok: true,
      data: { items: [payment] },
    });
    expect(await client.getRecurringPayment(ID)).toEqual({ ok: true, data: payment });
    expect(await client.getUpcomingRecurring()).toEqual({ ok: true, data: upcoming });
    expect(requestAt(fetch, 0)).toMatchObject({
      url: `${BASE_URL}/recurring/payments`,
      init: { method: 'GET', credentials: 'include' },
    });
    expect(requestAt(fetch, 1).url).toBe(`${BASE_URL}/recurring/payments/${ID}`);
    expect(requestAt(fetch, 2).url).toBe(`${BASE_URL}/recurring/upcoming`);
  });

  it('creates and updates a payment with the origin header', async () => {
    const { client, fetch } = clientWith(jsonResponse(201, payment), jsonResponse(200, payment));

    expect(await client.createRecurringPayment(createBody)).toEqual({ ok: true, data: payment });
    expect(await client.updateRecurringPayment(ID, { amount: '100' })).toEqual({
      ok: true,
      data: payment,
    });
    const created = requestAt(fetch, 0);
    expect(created.url).toBe(`${BASE_URL}/recurring/payments`);
    expect(created.init.method).toBe('POST');
    expect(JSON.parse(created.init.body as string)).toEqual(createBody);
    expect(new Headers(created.init.headers).get('X-Requested-With')).toBe('argent');
    const updated = requestAt(fetch, 1);
    expect(updated.url).toBe(`${BASE_URL}/recurring/payments/${ID}`);
    expect(updated.init.method).toBe('PATCH');
    expect(JSON.parse(updated.init.body as string)).toEqual({ amount: '100' });
  });

  it('pauses, resumes and deletes a payment (AC-13, AC-14, AC-15)', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, { ...payment, status: 'paused' }),
      jsonResponse(200, payment),
      new Response(null, { status: 204 }),
    );

    expect(await client.pauseRecurringPayment(ID)).toMatchObject({ ok: true });
    expect(await client.resumeRecurringPayment(ID)).toMatchObject({ ok: true });
    expect(await client.deleteRecurringPayment(ID)).toEqual({ ok: true, data: undefined });
    expect(requestAt(fetch, 0)).toMatchObject({
      url: `${BASE_URL}/recurring/payments/${ID}/pause`,
      init: { method: 'POST' },
    });
    expect(requestAt(fetch, 1)).toMatchObject({
      url: `${BASE_URL}/recurring/payments/${ID}/resume`,
      init: { method: 'POST' },
    });
    expect(requestAt(fetch, 2)).toMatchObject({
      url: `${BASE_URL}/recurring/payments/${ID}`,
      init: { method: 'DELETE' },
    });
  });

  it('confirms and skips an occurrence (AC-07, AC-09)', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, { id: OCCURRENCE_ID }),
      jsonResponse(200, {}),
    );

    // The answer's body is not part of the contract: callers reload the upcoming list.
    expect(await client.confirmOccurrence(OCCURRENCE_ID, { amount: '4825000' })).toEqual({
      ok: true,
      data: undefined,
    });
    expect(await client.skipOccurrence(OCCURRENCE_ID)).toEqual({ ok: true, data: undefined });
    const confirm = requestAt(fetch, 0);
    expect(confirm.url).toBe(`${BASE_URL}/recurring/occurrences/${OCCURRENCE_ID}/confirm`);
    expect(confirm.init.method).toBe('POST');
    expect(JSON.parse(confirm.init.body as string)).toEqual({ amount: '4825000' });
    expect(requestAt(fetch, 1)).toMatchObject({
      url: `${BASE_URL}/recurring/occurrences/${OCCURRENCE_ID}/skip`,
      init: { method: 'POST' },
    });
  });

  it.each([
    [404, 'NOT_FOUND', 'unexpected'],
    [400, 'VALIDATION_FAILED', 'validationFailed'],
    [409, 'RECURRING_OCCURRENCE_NOT_PENDING', 'recurringOccurrenceNotPending'],
    [409, 'RECURRING_LIMIT_REACHED', 'recurringLimitReached'],
    [409, 'ACCOUNT_ARCHIVED', 'accountArchived'],
  ])('maps a %i %s answer to its message key (AC-08, AC-17)', async (status, code, key) => {
    const { client } = clientWith(jsonResponse(status, { code, message: 'x' }));

    expect(await client.confirmOccurrence(OCCURRENCE_ID, {})).toMatchObject({
      ok: false,
      code,
      messageKey: key,
    });
  });

  it('maps 401 after a failed refresh, and a network failure (AC-17)', async () => {
    const unauthenticated = { code: 'UNAUTHENTICATED', message: 'x' };
    const first = clientWith(
      jsonResponse(401, unauthenticated),
      jsonResponse(401, unauthenticated),
      jsonResponse(401, unauthenticated),
    );
    expect(await first.client.getUpcomingRecurring()).toMatchObject({
      ok: false,
      code: 'UNAUTHENTICATED',
      messageKey: 'unauthenticated',
    });

    const fetch = vi.fn<FetchLike>(() => Promise.reject(new TypeError('offline')));
    const offline = createApiClient({ baseUrl: BASE_URL, fetch });
    expect(await offline.listRecurringPayments()).toMatchObject({
      ok: false,
      code: 'NETWORK',
      messageKey: 'network',
    });
  });

  it('refuses an unsafe id without calling the API', async () => {
    const { client, fetch } = clientWith();

    for (const result of [
      await client.getRecurringPayment('..'),
      await client.pauseRecurringPayment(''),
      await client.skipOccurrence('.'),
    ]) {
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a response that does not match the schema', async () => {
    const { client } = clientWith(jsonResponse(200, { items: [{ id: 1 }] }));

    expect(await client.listRecurringPayments()).toMatchObject({ ok: false });
  });
});
