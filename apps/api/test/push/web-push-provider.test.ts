import { createECDH } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PushMessage } from '../../src/push/application/ports/push-provider';
import { WebPushProvider } from '../../src/push/infrastructure/providers/web-push-provider';
import { RFC8291 } from './rfc8291-vector';

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const vapid = {
  publicKey: ecdh.getPublicKey().toString('base64url'),
  privateKey: ecdh.getPrivateKey().toString('base64url'),
  subject: 'mailto:push@pesly.com.ar',
};
const NOTICE_ID = '0b9c1f5e-2d4a-4c3b-8e7f-1a2b3c4d5e6f';
const URL_OK = 'https://fcm.googleapis.com/fcm/send/abc';

const message = (overrides: Partial<PushMessage> = {}): PushMessage => ({
  target: { pushUrl: URL_OK, p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret },
  body: new TextEncoder().encode('{"title":"hi"}'),
  ttlSeconds: 21600,
  topic: NOTICE_ID.replaceAll('-', ''),
  urgency: 'normal',
  ...overrides,
});

const answer = (status: number, headers: Record<string, string> = {}) =>
  vi.fn(() => Promise.resolve(new Response(null, { status, headers })));
const make = (fetchFn: typeof fetch) => new WebPushProvider({ vapid, fetch: fetchFn });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WebPushProvider', () => {
  it('sends the required headers and an encrypted body without following redirects', async () => {
    const fetchFn = answer(201);
    await make(fetchFn).send(message());
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_OK);
    const headers = new Headers(init.headers);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(headers.get('TTL')).toBe('21600');
    expect(headers.get('Topic')).toBe(NOTICE_ID.replaceAll('-', ''));
    expect(headers.get('Urgency')).toBe('normal');
    expect(headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(headers.get('Content-Type')).toBe('application/octet-stream');
    expect(headers.get('Authorization')).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    expect((init.body as Uint8Array).byteLength).toBeGreaterThan(86);
  });

  it.each([200, 201, 202])('maps %i to accepted', async (status) => {
    const outcome = await make(answer(status)).send(message());
    expect(outcome).toEqual({ kind: 'accepted' });
  });

  it.each([404, 410])('maps %i to gone', async (status) => {
    const outcome = await make(answer(status)).send(message());
    expect(outcome).toEqual({ kind: 'gone' });
  });

  it.each([400, 401, 403, 413, 418, 301, 302, 307])(
    'maps %i to rejected with the status',
    async (status) => {
      const fetchFn = answer(status);
      const outcome = await make(fetchFn).send(message());
      expect(outcome).toEqual({ kind: 'rejected', status });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it('maps an unexpected 2xx or 1xx-like status to rejected', async () => {
    const outcome = await make(answer(204)).send(message());
    expect(outcome).toEqual({ kind: 'rejected', status: 204 });
  });

  it('maps 429 with Retry-After seconds to retry', async () => {
    const outcome = await make(answer(429, { 'Retry-After': '120' })).send(message());
    expect(outcome).toEqual({ kind: 'retry', status: 429, retryAfterSeconds: 120 });
  });

  it('maps 503 without Retry-After to retry', async () => {
    const outcome = await make(answer(503)).send(message());
    expect(outcome).toEqual({ kind: 'retry', status: 503, retryAfterSeconds: null });
  });

  it('reads the HTTP date form of Retry-After', async () => {
    const date = new Date(Date.now() + 90_000).toUTCString();
    const outcome = await make(answer(503, { 'Retry-After': date })).send(message());
    expect(outcome.kind).toBe('retry');
    const seconds = (outcome as { retryAfterSeconds: number | null }).retryAfterSeconds;
    expect(seconds).toBeGreaterThanOrEqual(88);
    expect(seconds).toBeLessThanOrEqual(90);
  });

  it('ignores a negative or garbage Retry-After', async () => {
    for (const value of ['-5', 'soon']) {
      const outcome = await make(answer(429, { 'Retry-After': value })).send(message());
      expect(outcome).toEqual({ kind: 'retry', status: 429, retryAfterSeconds: null });
    }
  });

  it('maps a network error to retry with a null status', async () => {
    const fetchFn = vi.fn(() => {
      return Promise.reject(new TypeError('fetch failed'));
    });
    const outcome = await make(fetchFn).send(message());
    expect(outcome).toEqual({ kind: 'retry', status: null, retryAfterSeconds: null });
  });

  it('makes no request for a URL outside the allowlist', async () => {
    const fetchFn = answer(201);
    const outcome = await make(fetchFn).send(
      message({
        target: {
          pushUrl: 'https://evil.example.com/x',
          p256dh: RFC8291.uaPublic,
          auth: RFC8291.authSecret,
        },
      }),
    );
    expect(outcome).toEqual({ kind: 'rejected', status: null });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a 4000-byte body and a 64-byte public key without a request', async () => {
    const fetchFn = answer(201);
    const provider = make(fetchFn);
    expect(await provider.send(message({ body: new Uint8Array(4000) }))).toEqual({
      kind: 'rejected',
      status: null,
    });
    const shortKey = Buffer.alloc(64, 1).toString('base64url');
    expect(
      await provider.send(
        message({ target: { pushUrl: URL_OK, p256dh: shortKey, auth: RFC8291.authSecret } }),
      ),
    ).toEqual({ kind: 'rejected', status: null });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects an invalid topic or ttl without a request', async () => {
    const fetchFn = answer(201);
    const provider = make(fetchFn);
    for (const bad of [
      { topic: '' },
      { topic: 'a'.repeat(33) },
      { topic: 'a b' },
      { ttlSeconds: -1 },
      { ttlSeconds: 86401 },
      { ttlSeconds: 1.5 },
    ]) {
      expect(await provider.send(message(bad))).toEqual({ kind: 'rejected', status: null });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('aborts a request that never answers after 10 s and ends as retry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort(new DOMException('timed out', 'TimeoutError'));
      }, ms);
      return controller.signal;
    });
    let opened = 0;
    let closed = 0;
    const fetchFn = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          opened += 1;
          init?.signal?.addEventListener('abort', () => {
            closed += 1;
            reject(new Error('aborted'));
          });
        }),
    );
    const pending = make(fetchFn).send(message());
    // Signing the VAPID token is real async work; the request starts after it.
    await vi.waitFor(() => {
      expect(opened).toBe(1);
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(await pending).toEqual({ kind: 'retry', status: null, retryAfterSeconds: null });
    expect(opened).toBe(1);
    expect(closed).toBe(1);
  });
});
