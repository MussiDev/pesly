import { describe, expect, it, vi } from 'vitest';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const BASE_URL = 'http://api.argent.test';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
const P256DH = `${'B'.repeat(86)}A`;
const AUTH = `${'C'.repeat(21)}A`;
const PUBLIC_KEY = 'BPublicKeyValue';
const SUBSCRIPTION_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';

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

function sentRequest(fetch: ReturnType<typeof clientWith>['fetch']): {
  url: string;
  init: RequestInit;
} {
  const call = fetch.mock.calls[0];
  if (!call) throw new Error('no request was sent');
  return { url: call[0], init: call[1] ?? {} };
}

describe('getPushConfig', () => {
  it('parses the configuration (AC-50)', async () => {
    const { client, fetch } = clientWith(
      jsonResponse(200, { available: true, publicKey: PUBLIC_KEY }),
    );

    const result = await client.getPushConfig();

    expect(result).toEqual({ ok: true, data: { available: true, publicKey: PUBLIC_KEY } });
    expect(sentRequest(fetch).url).toBe(`${BASE_URL}/push/config`);
    expect(sentRequest(fetch).init.method).toBe('GET');
  });

  it('treats an inconsistent configuration as an unexpected answer', async () => {
    const { client } = clientWith(jsonResponse(200, { available: true, publicKey: null }));

    expect(await client.getPushConfig()).toMatchObject({ ok: false, code: 'INTERNAL' });
  });
});

describe('storePushSubscription', () => {
  it('sends only the endpoint and the two keys with PUT (AC-50)', async () => {
    const { client, fetch } = clientWith(jsonResponse(200, { id: SUBSCRIPTION_ID }));
    const withExtras = {
      endpoint: ENDPOINT,
      keys: { p256dh: P256DH, auth: AUTH },
      expirationTime: null,
    };

    const result = await client.storePushSubscription(withExtras);

    expect(result).toEqual({ ok: true, data: { id: SUBSCRIPTION_ID } });
    const { url, init } = sentRequest(fetch);
    expect(url).toBe(`${BASE_URL}/push/subscriptions`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: P256DH, auth: AUTH },
    });
  });

  it('maps a 400 and a network error to typed failures (AC-50)', async () => {
    const { client } = clientWith(
      jsonResponse(400, { code: 'VALIDATION_FAILED', message: 'x', fields: ['endpoint'] }),
      new TypeError('offline'),
    );
    const body = { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } };

    expect(await client.storePushSubscription(body)).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
      messageKey: 'validationFailed',
    });
    expect(await client.storePushSubscription(body)).toMatchObject({
      ok: false,
      code: 'NETWORK',
      messageKey: 'network',
    });
  });

  it('refuses a body that fails the shared schema before any request', async () => {
    const { client, fetch } = clientWith();

    const result = await client.storePushSubscription({
      endpoint: 'http://evil.example/x',
      keys: { p256dh: P256DH, auth: AUTH },
    });

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('removePushSubscription', () => {
  it('posts only the endpoint to the unsubscribe route and accepts 204 (AC-50)', async () => {
    const { client, fetch } = clientWith(new Response(null, { status: 204 }));

    const withExtras = { endpoint: ENDPOINT, extra: 'x' };

    const result = await client.removePushSubscription(withExtras);

    expect(result).toEqual({ ok: true, data: undefined });
    const { url, init } = sentRequest(fetch);
    expect(url).toBe(`${BASE_URL}/push/subscriptions/unsubscribe`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ endpoint: ENDPOINT });
  });

  it('maps a 404 to a typed failure (AC-50)', async () => {
    const { client } = clientWith(jsonResponse(404, { code: 'NOT_FOUND', message: 'x' }));

    expect(await client.removePushSubscription({ endpoint: ENDPOINT })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('refuses an empty endpoint before any request', async () => {
    const { client, fetch } = clientWith();

    expect(await client.removePushSubscription({ endpoint: '' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
