// @vitest-environment happy-dom
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPushSupport } from '../src/lib/push/push-support';
import { readSubscription, subscribe, unsubscribe } from '../src/lib/push/push-client';

const P256DH = `${'B'.repeat(86)}A`;
const AUTH = `${'C'.repeat(21)}A`;
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
// base64url of the bytes 1, 2, 3, 4
const PUBLIC_KEY = 'AQIDBA';

function fakeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    endpoint: ENDPOINT,
    expirationTime: null,
    unsubscribe: vi.fn(() => Promise.resolve(true)),
    toJSON: () => ({
      endpoint: ENDPOINT,
      expirationTime: null,
      keys: { p256dh: P256DH, auth: AUTH },
    }),
    ...overrides,
  };
}

function install(
  options: {
    existing?: ReturnType<typeof fakeSubscription> | null;
    /** No worker is registered: `ready` never settles, as in a browser. */
    unregistered?: boolean;
    created?: ReturnType<typeof fakeSubscription>;
    permission?: NotificationPermission;
  } = {},
) {
  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(options.existing ?? null)),
    subscribe: vi.fn<(options: unknown) => Promise<ReturnType<typeof fakeSubscription>>>(() =>
      Promise.resolve(options.created ?? fakeSubscription()),
    ),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: options.unregistered
      ? { ready: new Promise(() => undefined), getRegistration: () => Promise.resolve(undefined) }
      : {
          ready: Promise.resolve({ pushManager }),
          getRegistration: () => Promise.resolve({ pushManager }),
        },
    configurable: true,
  });
  const requestPermission = vi.fn(() => Promise.resolve(options.permission ?? 'granted'));
  vi.stubGlobal('Notification', { requestPermission, permission: 'default' });
  return { pushManager, requestPermission };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.unstubAllGlobals();
});

describe('readSubscription', () => {
  it('returns null without a subscription', async () => {
    install({ existing: null });

    expect(await readSubscription()).toBeNull();
  });

  it('returns only the endpoint and the two keys with one', async () => {
    install({ existing: fakeSubscription() });

    expect(await readSubscription()).toEqual({
      endpoint: ENDPOINT,
      keys: { p256dh: P256DH, auth: AUTH },
    });
  });

  it('returns null, without waiting for a worker, when none is registered', async () => {
    const { pushManager } = install({ unregistered: true });

    expect(await readSubscription()).toBeNull();
    expect(pushManager.getSubscription).not.toHaveBeenCalled();
  });
});

describe('subscribe', () => {
  it('asks the permission once and subscribes with userVisibleOnly and a Uint8Array key (AC-46)', async () => {
    const { pushManager, requestPermission } = install();

    const result = await subscribe(PUBLIC_KEY);

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    const options = (pushManager.subscribe.mock.calls[0]?.[0] ?? {}) as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect([...options.applicationServerKey]).toEqual([1, 2, 3, 4]);
    expect(result).toEqual({
      ok: true,
      subscription: { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } },
    });
  });

  it('fails as denied and creates no subscription when the permission is not granted (AC-46)', async () => {
    const { pushManager } = install({ permission: 'denied' });

    expect(await subscribe(PUBLIC_KEY)).toEqual({ ok: false, reason: 'denied' });
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('fails as error, never throws, when the browser fails', async () => {
    const { pushManager } = install();
    pushManager.subscribe.mockRejectedValueOnce(new Error('AbortError'));

    expect(await subscribe(PUBLIC_KEY)).toEqual({ ok: false, reason: 'error' });
  });

  it('fails as error when the browser subscription has no keys', async () => {
    install({ created: fakeSubscription({ toJSON: () => ({ endpoint: ENDPOINT }) }) });

    expect(await subscribe(PUBLIC_KEY)).toEqual({ ok: false, reason: 'error' });
  });
});

describe('unsubscribe', () => {
  it('removes the browser subscription', async () => {
    const existing = fakeSubscription();
    install({ existing });

    expect(await unsubscribe()).toBe(true);
    expect(existing.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('is true when there is no subscription', async () => {
    install({ existing: null });

    expect(await unsubscribe()).toBe(true);
  });

  it('is true, without waiting for a worker, when none is registered', async () => {
    install({ unregistered: true });

    expect(await unsubscribe()).toBe(true);
  });

  it('is false when the browser refuses', async () => {
    install({
      existing: fakeSubscription({ unsubscribe: vi.fn(() => Promise.reject(new Error('x'))) }),
    });

    expect(await unsubscribe()).toBe(false);
  });
});

describe('ios-needs-install (AC-54)', () => {
  it('is decided without touching the push client', () => {
    const { pushManager, requestPermission } = install();

    const state = getPushSupport({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
      maxTouchPoints: 5,
      standalone: false,
      hasPushManager: false,
      hasNotification: false,
      permission: 'default',
    });

    expect(state).toBe('ios-needs-install');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe('source guard (AC-47)', () => {
  it('keeps requestPermission only in push-client.ts', () => {
    const root = join(__dirname, '..', 'src');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && readFileSync(path, 'utf8').includes('requestPermission')) {
          hits.push(name);
        }
      }
    };
    walk(root);

    expect(hits).toEqual(['push-client.ts']);
  });
});
