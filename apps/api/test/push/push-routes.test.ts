import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { pushConfigResponseSchema } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPushRoutes } from '../../src/push';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import {
  cookieHeader,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders } from '../helpers/test-env';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';
const PUBLIC_KEY = createECDH('prime256v1').generateKeys().toString('base64url');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let sequence = 0;

/** Supertest types the body as `any`; the routes answer `{ id }` or `{ code }`. */
const bodyOf = (response: { body: unknown }) => response.body as { id: string; code: string };

const newEndpoint = () => `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;

function newKeys() {
  const ecdh = createECDH('prime256v1');
  return {
    p256dh: ecdh.generateKeys().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
}

async function setup(publicKey: string | null = PUBLIC_KEY) {
  sequence += 1;
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [createPushRoutes({ db: connection.db, logger, publicKey })],
  });
  const addUser = async (name: string, options: { verified?: boolean } = {}) => {
    const email = `${name}-${sequence}@push.test`;
    const id = await seedUser(connection, { email, password: PASSWORD, ...options });
    const cookies = sessionFrom(await signIn(harness.app, email, PASSWORD));
    return { id, cookies };
  };
  const ana = await addUser('ana');
  const bob = await addUser('bob');
  const eve = await addUser('eve', { verified: false });
  return { app: harness.app, lines, ana, bob, eve };
}

type Verb = 'get' | 'put' | 'post';

function call(
  app: Express,
  verb: Verb,
  path: string,
  cookies: Partial<SessionCookies> | undefined,
  body?: unknown,
) {
  const req = request(app)[verb](path).set(trustedHeaders);
  if (cookies) req.set('Cookie', cookieHeader(cookies));
  return verb === 'get' ? req : req.send(body ?? {});
}

const store = (
  app: Express,
  cookies: SessionCookies | undefined,
  endpoint: string,
  keys: { p256dh: string; auth: string } = newKeys(),
) => call(app, 'put', '/push/subscriptions', cookies, { endpoint, keys });

const unsubscribe = (app: Express, cookies: SessionCookies | undefined, endpoint: string) =>
  call(app, 'post', '/push/subscriptions/unsubscribe', cookies, { endpoint });

async function rowsOf(endpoint: string) {
  return (
    await connection.pool.query<{ id: string; user_id: string; p256dh: string; auth: string }>(
      'select id, user_id, p256dh, auth from push_subscriptions where endpoint = $1',
      [endpoint],
    )
  ).rows;
}

const countOf = async (userId: string) =>
  Number(
    (
      await connection.pool.query<{ n: string }>(
        'select count(*) as n from push_subscriptions where user_id = $1',
        [userId],
      )
    ).rows[0]?.n,
  );

async function seedDelivery(ownerId: string, subscriptionId: string): Promise<string> {
  const notice = await connection.pool.query<{ id: string }>(
    `insert into notices (owner_id, kind, payment_id, due_date, text)
     values ($1, 'reminder', gen_random_uuid(), '2026-10-05', 'x') returning id`,
    [ownerId],
  );
  const noticeId = notice.rows[0]?.id ?? '';
  const delivery = await connection.pool.query<{ id: string }>(
    `insert into push_deliveries (notice_id, subscription_id) values ($1, $2) returning id`,
    [noticeId, subscriptionId],
  );
  return delivery.rows[0]?.id ?? '';
}

const deliveryCount = async (subscriptionId: string) =>
  Number(
    (
      await connection.pool.query<{ n: string }>(
        'select count(*) as n from push_deliveries where subscription_id = $1',
        [subscriptionId],
      )
    ).rows[0]?.n,
  );

describe('PUT /push/subscriptions', () => {
  it('stores a valid subscription: 200 with a real uuid and one row (AC-01)', async () => {
    const s = await setup();
    const endpoint = newEndpoint();

    const response = await store(s.app, s.ana.cookies, endpoint);

    expect(response.status).toBe(200);
    const rows = await rowsOf(endpoint);
    expect(rows).toHaveLength(1);
    expect(response.body).toEqual({ id: rows[0]?.id });
    expect(bodyOf(response).id).toMatch(UUID);
    expect(rows[0]?.user_id).toBe(s.ana.id);
  });

  it('storing the same endpoint again updates the keys and returns the same id (AC-02)', async () => {
    const s = await setup();
    const endpoint = newEndpoint();
    const first = await store(s.app, s.ana.cookies, endpoint);
    const keys = newKeys();

    const second = await store(s.app, s.ana.cookies, endpoint, keys);

    expect(second.status).toBe(200);
    expect(bodyOf(second).id).toBe(bodyOf(first).id);
    const rows = await rowsOf(endpoint);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p256dh).toBe(keys.p256dh);
    expect(rows[0]?.auth).toBe(keys.auth);
  });

  it('moves the endpoint to the second user and deletes the first user pending deliveries (AC-03)', async () => {
    const s = await setup();
    const endpoint = newEndpoint();
    const first = await store(s.app, s.ana.cookies, endpoint);
    await seedDelivery(s.ana.id, bodyOf(first).id);
    expect(await deliveryCount(bodyOf(first).id)).toBe(1);

    const second = await store(s.app, s.bob.cookies, endpoint);

    expect(second.status).toBe(200);
    const rows = await rowsOf(endpoint);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(s.bob.id);
    expect(await deliveryCount(bodyOf(second).id)).toBe(0);
  });

  it('keeps the deliveries of the same owner when the endpoint is stored again (AC-03)', async () => {
    const s = await setup();
    const endpoint = newEndpoint();
    const first = await store(s.app, s.ana.cookies, endpoint);
    await seedDelivery(s.ana.id, bodyOf(first).id);

    await store(s.app, s.ana.cookies, endpoint);

    expect(await deliveryCount(bodyOf(first).id)).toBe(1);
  });

  it('answers 401 UNAUTHENTICATED with no session on the three routes and stores nothing (AC-04)', async () => {
    const s = await setup();
    const endpoint = newEndpoint();

    for (const response of [
      await call(s.app, 'get', '/push/config', undefined),
      await store(s.app, undefined, endpoint),
      await unsubscribe(s.app, undefined, endpoint),
    ]) {
      expect(response.status).toBe(401);
      expect(bodyOf(response).code).toBe('UNAUTHENTICATED');
    }
    expect(await rowsOf(endpoint)).toHaveLength(0);
  });

  it('requires a verified email', async () => {
    const s = await setup();
    const endpoint = newEndpoint();

    const response = await store(s.app, s.eve.cookies, endpoint);

    expect(response.status).toBe(403);
    expect(await rowsOf(endpoint)).toHaveLength(0);
  });

  it.each([
    ['http', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['off the allowlist', 'https://evil.example/x'],
    ['an IP address', 'https://127.0.0.1/x'],
    ['localhost', 'https://localhost/x'],
    ['credentials', 'https://user:pw@fcm.googleapis.com/x'],
    ['port 8443', 'https://fcm.googleapis.com:8443/x'],
  ])('rejects an endpoint that is %s with 400 and stores nothing (AC-05)', async (_name, url) => {
    const s = await setup();

    const response = await store(s.app, s.ana.cookies, url);

    expect(response.status).toBe(400);
    expect(bodyOf(response).code).toBe('VALIDATION_FAILED');
    expect(await rowsOf(url)).toHaveLength(0);
    expect(await countOf(s.ana.id)).toBe(0);
  });

  it('rejects wrong key lengths, a 2,049-character endpoint and an off-curve key (AC-06)', async () => {
    const s = await setup();
    const good = newKeys();
    const offCurve = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url');
    const longEndpoint = `https://fcm.googleapis.com/${'a'.repeat(2049 - 'https://fcm.googleapis.com/'.length)}`;
    expect(longEndpoint).toHaveLength(2049);

    const attempts = [
      store(s.app, s.ana.cookies, newEndpoint(), {
        p256dh: randomBytes(64).toString('base64url'),
        auth: good.auth,
      }),
      store(s.app, s.ana.cookies, newEndpoint(), {
        p256dh: good.p256dh,
        auth: randomBytes(15).toString('base64url'),
      }),
      store(s.app, s.ana.cookies, longEndpoint),
      store(s.app, s.ana.cookies, newEndpoint(), { p256dh: offCurve, auth: good.auth }),
    ];
    for (const attempt of attempts) {
      const response = await attempt;
      expect(response.status).toBe(400);
      expect(bodyOf(response).code).toBe('VALIDATION_FAILED');
    }
    expect(await countOf(s.ana.id)).toBe(0);
  });

  it('replaces the least recently updated at the 11th and caps concurrent stores at 10 (AC-07)', async () => {
    const s = await setup();
    const endpoints: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const endpoint = newEndpoint();
      endpoints.push(endpoint);
      await store(s.app, s.ana.cookies, endpoint);
      await connection.pool.query(
        `update push_subscriptions set updated_at = now() - make_interval(mins => $2) where endpoint = $1`,
        [endpoint, 100 - i],
      );
    }

    const response = await store(s.app, s.ana.cookies, newEndpoint());

    expect(response.status).toBe(200);
    expect(await countOf(s.ana.id)).toBe(10);
    expect(await rowsOf(endpoints[0] ?? '')).toHaveLength(0);
    expect(await rowsOf(endpoints[1] ?? '')).toHaveLength(1);

    await connection.pool.query('delete from push_subscriptions where user_id = $1', [s.bob.id]);
    for (let i = 0; i < 9; i += 1) await store(s.app, s.bob.cookies, newEndpoint());
    const results = await Promise.all(
      Array.from({ length: 4 }, () => store(s.app, s.bob.cookies, newEndpoint())),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await countOf(s.bob.id)).toBeLessThanOrEqual(10);
  });
});

describe('POST /push/subscriptions/unsubscribe', () => {
  it('removes one device and keeps the other: 204 (AC-08)', async () => {
    const s = await setup();
    const one = newEndpoint();
    const two = newEndpoint();
    await store(s.app, s.ana.cookies, one);
    await store(s.app, s.ana.cookies, two);

    const response = await unsubscribe(s.app, s.ana.cookies, one);

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(await rowsOf(one)).toHaveLength(0);
    expect(await rowsOf(two)).toHaveLength(1);
  });

  it('answers 404 NOT_FOUND for an endpoint that is not stored (AC-09)', async () => {
    const s = await setup();
    await store(s.app, s.ana.cookies, newEndpoint());

    const response = await unsubscribe(s.app, s.ana.cookies, newEndpoint());

    expect(response.status).toBe(404);
    expect(bodyOf(response).code).toBe('NOT_FOUND');
    expect(await countOf(s.ana.id)).toBe(1);
  });

  it('answers 404 for another user endpoint and leaves the row and deliveries (AC-11)', async () => {
    const s = await setup();
    const endpoint = newEndpoint();
    const stored = await store(s.app, s.ana.cookies, endpoint);
    await seedDelivery(s.ana.id, bodyOf(stored).id);

    const response = await unsubscribe(s.app, s.bob.cookies, endpoint);

    expect(response.status).toBe(404);
    expect(bodyOf(response).code).toBe('NOT_FOUND');
    expect((await rowsOf(endpoint))[0]?.user_id).toBe(s.ana.id);
    expect(await deliveryCount(bodyOf(stored).id)).toBe(1);
  });

  it('answers 400 for a missing endpoint', async () => {
    const s = await setup();

    const response = await call(
      s.app,
      'post',
      '/push/subscriptions/unsubscribe',
      s.ana.cookies,
      {},
    );

    expect(response.status).toBe(400);
  });
});

describe('GET /push/config', () => {
  it('answers available with the public key when it is set (AC-12)', async () => {
    const s = await setup(PUBLIC_KEY);

    const response = await call(s.app, 'get', '/push/config', s.ana.cookies);

    expect(response.status).toBe(200);
    expect(pushConfigResponseSchema.parse(response.body)).toEqual({
      available: true,
      publicKey: PUBLIC_KEY,
    });
  });

  it('answers unavailable with a null key when it is not set (AC-13)', async () => {
    const s = await setup(null);

    const response = await call(s.app, 'get', '/push/config', s.ana.cookies);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ available: false, publicKey: null });
  });
});

describe('logging (NFR-07)', () => {
  it('keeps the endpoint and the keys out of audit lines and error bodies', async () => {
    const s = await setup();
    const endpoint = newEndpoint();
    const keys = newKeys();
    const badEndpoint = 'https://evil.example/secret-path';

    const ok = await store(s.app, s.ana.cookies, endpoint, keys);
    const failed = await store(s.app, s.ana.cookies, badEndpoint, keys);
    await unsubscribe(s.app, s.ana.cookies, endpoint);
    await unsubscribe(s.app, s.ana.cookies, newEndpoint());

    expect(ok.status).toBe(200);
    expect(failed.status).toBe(400);
    const everything = [...s.lines, JSON.stringify(failed.body)].join('\n');
    for (const secret of [endpoint, keys.p256dh, keys.auth, badEndpoint, 'secret-path']) {
      expect(everything).not.toContain(secret);
    }
    expect(s.lines.some((line) => line.includes(bodyOf(ok).id))).toBe(true);
  });
});
