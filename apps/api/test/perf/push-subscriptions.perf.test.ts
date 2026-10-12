import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPushRoutes } from '../../src/push';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';

/**
 * NFR-05 benchmark: p95 of storing and removing a subscription for a user holding 10 of them,
 * through the real app and sessions. Timing-dependent, so it runs with `pnpm test:perf`.
 */

const REQUESTS = 100;
const WARM_UP_REQUESTS = 10;
const MAX_P95_MS = 300;
const PASSWORD = 'a long enough passphrase';
const EMAIL = 'perf-push@example.com';

let connection: DatabaseConnection;
let server: Server | undefined;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (server) {
      server.close(() => {
        resolve();
      });
    } else {
      resolve();
    }
  });
  server = undefined;
});

afterAll(async () => {
  await connection.pool.end();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

const newEndpoint = () => `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
const newKeys = () => ({
  p256dh: createECDH('prime256v1').generateKeys().toString('base64url'),
  auth: randomBytes(16).toString('base64url'),
});

describe('push subscriptions latency (NFR-05)', () => {
  it('keeps p95 of store and remove below 300 ms for a user with 10 subscriptions', async () => {
    const routes = createPushRoutes({
      db: connection.db,
      logger: createLogger({ level: 'error', destination: { write: () => undefined } }),
      publicKey: null,
    });
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [routes],
    });
    const userId = await seedUser(connection, { email: EMAIL, password: PASSWORD });
    const cookies = sessionFrom(await signIn(harness.app, EMAIL, PASSWORD));
    const endpoints = Array.from({ length: 10 }, newEndpoint);
    for (const endpoint of endpoints) {
      const keys = newKeys();
      await connection.pool.query(
        'insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)',
        [userId, endpoint, keys.p256dh, keys.auth],
      );
    }

    server = createServer(harness.app);
    const target = server;
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const address = target.address();
    if (address === null || typeof address === 'string') throw new Error('no address');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = {
      ...trustedHeaders,
      'content-type': 'application/json',
      cookie: cookieHeader(cookies),
    };

    const timed = async (path: string, method: string, body: unknown): Promise<number> => {
      const start = performance.now();
      const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: JSON.stringify(body),
      });
      const elapsed = performance.now() - start;
      await response.arrayBuffer();
      return elapsed;
    };

    const stores: number[] = [];
    for (let i = 0; i < WARM_UP_REQUESTS + REQUESTS; i += 1) {
      const elapsed = await timed('/push/subscriptions', 'PUT', {
        endpoint: endpoints[i % 10],
        keys: newKeys(),
      });
      if (i >= WARM_UP_REQUESTS) stores.push(elapsed);
    }

    const removes: number[] = [];
    for (let i = 0; i < WARM_UP_REQUESTS + REQUESTS; i += 1) {
      const endpoint = endpoints[i % 10] ?? '';
      const keys = newKeys();
      await connection.pool.query(
        `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)
         on conflict (endpoint) do nothing`,
        [userId, endpoint, keys.p256dh, keys.auth],
      );
      const elapsed = await timed('/push/subscriptions/unsubscribe', 'POST', { endpoint });
      if (i >= WARM_UP_REQUESTS) removes.push(elapsed);
    }

    expect(percentile(stores, 95)).toBeLessThan(MAX_P95_MS);
    expect(percentile(removes, 95)).toBeLessThan(MAX_P95_MS);
  });
});
