import { listNoticesResponseSchema, noticeSchema, type ListNoticesResponse } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNoticesRoutes } from '../../src/notices';
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
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
let sequence = 0;

async function setup() {
  sequence += 1;
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [createNoticesRoutes({ db: connection.db, logger })],
  });
  const addUser = async (name: string, options: { verified?: boolean } = {}) => {
    const email = `${name}-${sequence}@notices.test`;
    const id = await seedUser(connection, { email, password: PASSWORD, ...options });
    const cookies = sessionFrom(await signIn(harness.app, email, PASSWORD));
    return { id, cookies };
  };
  const ana = await addUser('ana');
  const bob = await addUser('bob');
  const eve = await addUser('eve', { verified: false });
  return { app: harness.app, lines, ana, bob, eve };
}

type Method = 'get' | 'post';

function call(app: Express, method: Method, path: string, cookies?: Partial<SessionCookies>) {
  const req = request(app)[method](path).set(trustedHeaders);
  if (cookies) req.set('Cookie', cookieHeader(cookies));
  return method === 'get' ? req : req.send({});
}

/** Inserts `count` notices for the owner, oldest first, `created_at` one second apart. */
async function seed(ownerId: string, count: number, label = 'n'): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const result = await connection.pool.query<{ id: string }>(
      `insert into notices (owner_id, kind, payment_id, due_date, text, created_at)
       values ($1, 'reminder', gen_random_uuid(), '2026-10-05', $2, now() - make_interval(secs => $3))
       returning id`,
      [ownerId, `${label}-${i}`, count - i],
    );
    ids.push(result.rows[0]?.id ?? '');
  }
  return ids;
}

async function listOf(
  app: Express,
  cookies: SessionCookies,
  query = '',
): Promise<ListNoticesResponse> {
  const response = await call(app, 'get', `/notices${query}`, cookies);
  expect(response.status).toBe(200);
  return listNoticesResponseSchema.parse(response.body);
}

const readAtOf = async (id: string) =>
  (
    await connection.pool.query<{ read_at: Date | null }>(
      'select read_at from notices where id = $1',
      [id],
    )
  ).rows[0]?.read_at ?? null;

describe('GET /notices', () => {
  it('pages 60 notices as 50 then 10, newest first, with the unread count (AC-18)', async () => {
    const s = await setup();
    await seed(s.ana.id, 60);

    const first = await listOf(s.app, s.ana.cookies, '?limit=50');
    expect(first.items).toHaveLength(50);
    expect(first.items[0]?.text).toBe('n-59');
    expect(first.nextCursor).not.toBeNull();
    expect(first.unreadCount).toBe(60);

    const second = await listOf(s.app, s.ana.cookies, `?limit=50&cursor=${first.nextCursor ?? ''}`);
    expect(second.items).toHaveLength(10);
    expect(second.items[0]?.text).toBe('n-9');
    expect(second.nextCursor).toBeNull();
    expect(second.unreadCount).toBe(60);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(60);
  });

  it('rejects limit 51 and a malformed cursor with 400 VALIDATION_FAILED (AC-19)', async () => {
    const s = await setup();
    await seed(s.ana.id, 2);

    for (const query of ['?limit=51', '?limit=0', '?cursor=not-a-cursor', '?cursor=%25%25']) {
      const response = await call(s.app, 'get', `/notices${query}`, s.ana.cookies);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });

  it("never lists another user's notice (AC-22)", async () => {
    const s = await setup();
    await seed(s.ana.id, 2, 'ana');
    await seed(s.bob.id, 3, 'bob');

    const page = await listOf(s.app, s.ana.cookies);

    expect(page.items.map((item) => item.text)).toEqual(['ana-1', 'ana-0']);
    expect(page.unreadCount).toBe(2);
  });
});

describe('POST /notices/:id/read', () => {
  it('marks one read, keeps it in the list as read and drops the unread count by 1 (AC-20)', async () => {
    const s = await setup();
    const [id] = await seed(s.ana.id, 3);

    const response = await call(s.app, 'post', `/notices/${id}/read`, s.ana.cookies);

    expect(response.status).toBe(200);
    const notice = noticeSchema.parse(response.body);
    expect(notice.id).toBe(id);
    expect(notice.readAt).not.toBeNull();
    const page = await listOf(s.app, s.ana.cookies);
    expect(page.items).toHaveLength(3);
    expect(page.items.find((item) => item.id === id)?.readAt).not.toBeNull();
    expect(page.unreadCount).toBe(2);
  });

  it("answers 404 NOT_FOUND for another user's or a missing notice and leaves it unread (AC-22)", async () => {
    const s = await setup();
    const [bobs] = await seed(s.bob.id, 1);

    const foreign = await call(s.app, 'post', `/notices/${bobs}/read`, s.ana.cookies);
    const missing = await call(s.app, 'post', `/notices/${MISSING_ID}/read`, s.ana.cookies);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ code: 'NOT_FOUND' });
    expect(missing.status).toBe(404);
    expect(await readAtOf(bobs ?? '')).toBeNull();
  });

  it('answers 400 VALIDATION_FAILED when the id is not a uuid', async () => {
    const s = await setup();

    const response = await call(s.app, 'post', '/notices/not-a-uuid/read', s.ana.cookies);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('writes an audit line with ids only', async () => {
    const s = await setup();
    const [id] = await seed(s.ana.id, 1, 'secret-text');

    await call(s.app, 'post', `/notices/${id}/read`, s.ana.cookies);

    const audit = s.lines.filter((line) => line.includes('notice'));
    expect(audit.some((line) => line.includes(id ?? ''))).toBe(true);
    expect(audit.some((line) => line.includes('secret-text'))).toBe(false);
  });
});

describe('POST /notices/read-all', () => {
  it('answers { unreadCount: 0 } and the next list shows 0 unread (AC-21)', async () => {
    const s = await setup();
    await seed(s.ana.id, 4);
    await seed(s.bob.id, 2);

    const response = await call(s.app, 'post', '/notices/read-all', s.ana.cookies);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ unreadCount: 0 });
    const page = await listOf(s.app, s.ana.cookies);
    expect(page.unreadCount).toBe(0);
    expect(page.items.every((item) => item.readAt !== null)).toBe(true);
    expect((await listOf(s.app, s.bob.cookies)).unreadCount).toBe(2);
  });
});

describe('authentication', () => {
  it('answers 401 UNAUTHENTICATED without a session on the three routes (AC-22)', async () => {
    const s = await setup();
    for (const [method, path] of [
      ['get', '/notices'],
      ['post', '/notices/read-all'],
      ['post', `/notices/${MISSING_ID}/read`],
    ] as const) {
      const response = await call(s.app, method, path);
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });

  it('answers 403 EMAIL_NOT_VERIFIED before the email is verified', async () => {
    const s = await setup();

    const response = await call(s.app, 'get', '/notices', s.eve.cookies);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
  });
});
