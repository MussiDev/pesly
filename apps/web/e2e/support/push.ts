import { generateKeyPairSync, randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { withE2eDatabase } from './database';

export interface FakeBrowserSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** An allowlisted push service URL: the API checks the host, never calls it, in e2e. */
export const ALLOWED_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/e2e-device';
/** A well formed URL on a host the API does not accept. */
export const DISALLOWED_ENDPOINT = 'https://push.example.test/send/e2e-device';

/** A subscription whose keys are valid: a P-256 public point (65 bytes) and 16 bytes of secret. */
export function fakeSubscription(endpoint: string): FakeBrowserSubscription {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const point = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x ?? '', 'base64url'),
    Buffer.from(jwk.y ?? '', 'base64url'),
  ]);
  return {
    endpoint,
    p256dh: point.toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

const SUBSCRIPTION_KEY = 'e2e-push-subscription';
const PERMISSION_KEY = 'e2e-push-permission';
const ASKS_KEY = 'e2e-push-permission-asks';

/**
 * Replaces what the browser offers for push before any page script runs: the service worker's
 * `ready` registration gets a push manager, and `Notification` answers a permission request with
 * "granted". The state lives in `localStorage`, so it survives a reload as a real subscription
 * does. Everything else of `navigator.serviceWorker` stays the real one.
 */
export async function installFakePush(page: Page, subscription: FakeBrowserSubscription) {
  await page.addInitScript(
    ({ fake, keys }) => {
      if (!location.origin.startsWith('http')) return;
      const store = window.localStorage;
      const current = () => ({
        endpoint: fake.endpoint,
        expirationTime: null,
        toJSON: () => ({
          endpoint: fake.endpoint,
          expirationTime: null,
          keys: { p256dh: fake.p256dh, auth: fake.auth },
        }),
        unsubscribe: () => {
          store.removeItem(keys.subscription);
          return Promise.resolve(true);
        },
      });
      const pushManager = {
        getSubscription: () =>
          Promise.resolve(store.getItem(keys.subscription) === null ? null : current()),
        subscribe: () => {
          store.setItem(keys.subscription, '1');
          return Promise.resolve(current());
        },
      };
      Object.defineProperty(window, 'Notification', {
        configurable: true,
        value: {
          get permission() {
            return store.getItem(keys.permission) ?? 'default';
          },
          requestPermission: () => {
            store.setItem(keys.asks, String(Number(store.getItem(keys.asks) ?? '0') + 1));
            store.setItem(keys.permission, 'granted');
            return Promise.resolve('granted');
          },
        },
      });
      const real = navigator.serviceWorker;
      const ready = Promise.resolve({ pushManager });
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: new Proxy(real, {
          get(target, property) {
            if (property === 'ready') return ready;
            const value: unknown = Reflect.get(target, property, target);
            return typeof value === 'function'
              ? (value as (...args: unknown[]) => unknown).bind(target)
              : value;
          },
        }),
      });
    },
    {
      fake: subscription,
      keys: { subscription: SUBSCRIPTION_KEY, permission: PERMISSION_KEY, asks: ASKS_KEY },
    },
  );
}

/** How many times the page asked the browser for the notification permission. */
export function permissionAsks(page: Page): Promise<number> {
  return page.evaluate((key) => Number(window.localStorage.getItem(key) ?? '0'), ASKS_KEY);
}

/** Whether the fake browser still holds a subscription. */
export function browserHasSubscription(page: Page): Promise<boolean> {
  return page.evaluate((key) => window.localStorage.getItem(key) !== null, SUBSCRIPTION_KEY);
}

/** The subscriptions the API stores for `email`: the endpoints only. */
export async function storedEndpoints(email: string): Promise<string[]> {
  const { rows } = await withE2eDatabase((client) =>
    client.query(
      `select p.endpoint from push_subscriptions p join users u on u.id = p.user_id
        where u.email = $1
        order by p.created_at, p.id`,
      [email],
    ),
  );
  return rows.map((row) => String(row.endpoint));
}
