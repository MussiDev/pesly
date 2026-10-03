import { randomUUID } from 'node:crypto';
import { listMovementsResponseSchema, movementResponseSchema } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMovementRoutes, createTagRoutes } from '../../src/movements';
import type { Database } from '../../src/shared/db/client';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../fakes/mutable-clock';
import { createIdentityHarness } from '../helpers/identity-harness';
import {
  cookieHeader,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { trustedHeaders, WEB_ORIGIN } from '../helpers/test-env';
import { newAccount, newCategory } from './db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

beforeEach(async () => {
  await connection.pool.query(`delete from exchange_rates where rate_type in ('blue', 'mep')`);
});

const PASSWORD = 'a long enough passphrase';

interface Setup {
  app: Express;
  ana: SessionCookies;
  bob: SessionCookies;
  anaId: string;
  bobId: string;
  clock: MutableClock;
  lines: string[];
  /** Lines of the app logger, where the error middleware writes. */
  appLines: string[];
}

interface SetupOptions {
  db?: Database;
  writeLimit?: number;
}

async function setup(options: SetupOptions = {}): Promise<Setup> {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const clock = new MutableClock();
  const routes = createMovementRoutes({
    db: options.db ?? connection.db,
    logger,
    clock,
    ...(options.writeLimit === undefined ? {} : { writeLimit: options.writeLimit }),
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [routes, createTagRoutes({ db: options.db ?? connection.db, logger })],
  });
  const suffix = randomUUID();
  const anaEmail = `ana-${suffix}@example.com`;
  const bobEmail = `bob-${suffix}@example.com`;
  const anaId = await seedUser(connection, { email: anaEmail, password: PASSWORD });
  const bobId = await seedUser(connection, { email: bobEmail, password: PASSWORD });
  const ana = sessionFrom(await signIn(harness.app, anaEmail, PASSWORD));
  const bob = sessionFrom(await signIn(harness.app, bobEmail, PASSWORD));
  return { app: harness.app, ana, bob, anaId, bobId, clock, lines, appLines: harness.lines };
}

function get(app: Express, path: string, cookies?: Partial<SessionCookies>) {
  const call = request(app).get(path);
  if (cookies) call.set('Cookie', cookieHeader(cookies));
  return call;
}

function post(app: Express, body: unknown, cookies?: Partial<SessionCookies>) {
  const call = request(app).post('/movements').set(trustedHeaders);
  if (cookies) call.set('Cookie', cookieHeader(cookies));
  return call.send(body as object);
}

async function seedRate(rateType: 'mep' | 'blue', sell: bigint): Promise<void> {
  await connection.pool.query(
    `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
     values ($1, $2, $3, now(), now())
     on conflict (rate_type) do update set sell = excluded.sell, buy = excluded.buy, fetched_at = now()`,
    [rateType, (sell - 100n).toString(), sell.toString()],
  );
}

const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

interface Fixture {
  accountId: string;
  expenseCategoryId: string;
  incomeCategoryId: string;
}

async function fixture(ownerId: string): Promise<Fixture> {
  return {
    accountId: await newAccount(connection.pool, ownerId),
    expenseCategoryId: await newCategory(connection.pool, ownerId, 'expense'),
    incomeCategoryId: await newCategory(connection.pool, ownerId, 'income'),
  };
}

function expenseBody(f: Fixture, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'expense',
    accountId: f.accountId,
    categoryId: f.expenseCategoryId,
    amount: '150000',
    occurredAt: hoursAgo(1),
    rate: { source: 'manual', value: '14000000' },
    ...overrides,
  };
}

async function countMovements(ownerId: string): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    'select count(*) as n from movements where owner_id = $1',
    [ownerId],
  );
  return Number(result.rows[0]?.n ?? 0);
}

describe('POST /movements and GET /movements', () => {
  it('creates an expense and an income and lists them newest first (AC-01, AC-04, AC-14)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const older = await post(s.app, expenseBody(f, { occurredAt: hoursAgo(3) }), s.ana);
    expect(older.status).toBe(201);
    const newer = await post(
      s.app,
      expenseBody(f, {
        type: 'income',
        categoryId: f.incomeCategoryId,
        occurredAt: hoursAgo(2),
        note: '  sueldo  ',
      }),
      s.ana,
    );
    expect(newer.status).toBe(201);
    const created = movementResponseSchema.parse(newer.body);
    expect(created).toMatchObject({
      type: 'income',
      accountId: f.accountId,
      categoryId: f.incomeCategoryId,
      amount: '150000',
      note: 'sueldo',
    });

    const response = await get(s.app, '/movements', s.ana);
    expect(response.status).toBe(200);
    const list = listMovementsResponseSchema.parse(response.body);
    expect(list.total).toBe(2);
    expect(list.limit).toBe(50);
    expect(list.offset).toBe(0);
    expect(list.items.map((item) => item.type)).toEqual(['income', 'expense']);

    const single = await get(s.app, `/movements/${created.id}`, s.ana);
    expect(single.status).toBe(200);
    expect(movementResponseSchema.parse(single.body).id).toBe(created.id);
  });

  it('ignores an owner, id and timestamps sent in the body: the movement belongs to the caller (threat R-16)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const smuggledId = '11111111-1111-4111-8111-111111111111';
    const response = await post(
      s.app,
      expenseBody(f, {
        id: smuggledId,
        ownerId: s.bobId,
        createdAt: '2001-01-01T00:00:00.000Z',
        rateType: 'blue',
      }),
      s.ana,
    );
    expect(response.status).toBe(201);
    const created = movementResponseSchema.parse(response.body);
    expect(created.id).not.toBe(smuggledId);
    const stored = await connection.pool.query<{ owner_id: string }>(
      'select owner_id from movements where id = $1',
      [created.id],
    );
    expect(stored.rows[0]?.owner_id).toBe(s.anaId);
    expect(await countMovements(s.bobId)).toBe(0);
  });

  it('answers 400 VALIDATION_FAILED naming body.amount for an amount of 0 and stores nothing (AC-02)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const response = await post(s.app, expenseBody(f, { amount: '0' }), s.ana);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((response.body as { fields: string[] }).fields).toContain('body.amount');
    expect(await countMovements(s.anaId)).toBe(0);
  });

  it('answers 400 MOVEMENT_CATEGORY_KIND_MISMATCH for a category of the other kind (AC-03, AC-05)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const expenseInIncome = await post(
      s.app,
      expenseBody(f, { categoryId: f.incomeCategoryId }),
      s.ana,
    );
    expect(expenseInIncome.status).toBe(400);
    expect(expenseInIncome.body).toEqual({ code: 'MOVEMENT_CATEGORY_KIND_MISMATCH' });
    const incomeInExpense = await post(s.app, expenseBody(f, { type: 'income' }), s.ana);
    expect(incomeInExpense.status).toBe(400);
    expect(incomeInExpense.body).toEqual({ code: 'MOVEMENT_CATEGORY_KIND_MISMATCH' });
    expect(await countMovements(s.anaId)).toBe(0);
  });

  it('returns the stored rate and source: automatic with the default type sell price, manual as typed (AC-06, AC-08)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    await seedRate('mep', 14_123_457n);
    const automatic = await post(s.app, expenseBody(f, { rate: { source: 'automatic' } }), s.ana);
    expect(automatic.status).toBe(201);
    expect(movementResponseSchema.parse(automatic.body)).toMatchObject({
      rate: '14123457',
      rateSource: 'automatic',
      rateType: 'mep',
    });
    const manual = await post(
      s.app,
      expenseBody(f, { rate: { source: 'manual', value: '15000000' } }),
      s.ana,
    );
    expect(manual.status).toBe(201);
    expect(movementResponseSchema.parse(manual.body)).toMatchObject({
      rate: '15000000',
      rateSource: 'manual',
      rateType: null,
    });
  });

  it('answers 400 VALIDATION_FAILED for a manual rate of 0 (AC-09)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const response = await post(
      s.app,
      expenseBody(f, { rate: { source: 'manual', value: '0' } }),
      s.ana,
    );
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await countMovements(s.anaId)).toBe(0);
  });

  it('answers 400 RATE_REQUIRED for an automatic rate with none stored and accepts a manual one (AC-20, AC-21)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const automatic = await post(s.app, expenseBody(f, { rate: { source: 'automatic' } }), s.ana);
    expect(automatic.status).toBe(400);
    expect(automatic.body).toEqual({ code: 'RATE_REQUIRED' });
    const manual = await post(s.app, expenseBody(f), s.ana);
    expect(manual.status).toBe(201);
  });

  it('keeps the saved rate when the stored rates refresh afterwards (AC-10)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    await seedRate('mep', 14_000_000n);
    const created = await post(s.app, expenseBody(f, { rate: { source: 'automatic' } }), s.ana);
    const id = movementResponseSchema.parse(created.body).id;
    await seedRate('mep', 16_500_000n);
    const single = await get(s.app, `/movements/${id}`, s.ana);
    expect(movementResponseSchema.parse(single.body).rate).toBe('14000000');
  });

  it('answers 400 MOVEMENT_DATE_IN_FUTURE for a local date after today (AC-15)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const response = await post(
      s.app,
      expenseBody(f, { occurredAt: new Date(Date.now() + 2 * 86_400_000).toISOString() }),
      s.ana,
    );
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'MOVEMENT_DATE_IN_FUTURE' });
    expect(await countMovements(s.anaId)).toBe(0);
  });

  it('rejects a movement on an archived account or category and accepts it after unarchiving (AC-25, AC-26, AC-27)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    await connection.pool.query('update accounts set archived_at = now() where id = $1', [
      f.accountId,
    ]);
    const onAccount = await post(s.app, expenseBody(f), s.ana);
    expect(onAccount.status).toBe(409);
    expect(onAccount.body).toEqual({ code: 'ACCOUNT_ARCHIVED' });
    await connection.pool.query('update accounts set archived_at = null where id = $1', [
      f.accountId,
    ]);
    await connection.pool.query('update categories set archived_at = now() where id = $1', [
      f.expenseCategoryId,
    ]);
    const onCategory = await post(s.app, expenseBody(f), s.ana);
    expect(onCategory.status).toBe(409);
    expect(onCategory.body).toEqual({ code: 'CATEGORY_ARCHIVED' });
    expect(await countMovements(s.anaId)).toBe(0);
    await connection.pool.query('update categories set archived_at = null where id = $1', [
      f.expenseCategoryId,
    ]);
    expect((await post(s.app, expenseBody(f), s.ana)).status).toBe(201);
  });
});

describe('creation limit', () => {
  it('answers 429 RATE_LIMITED with Retry-After on the 61st creation, stores nothing more and accepts again next minute (AC-28, AC-29)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    for (let i = 0; i < 60; i += 1) {
      const response = await post(s.app, expenseBody(f), s.ana);
      expect(response.status).toBe(201);
    }
    const limited = await post(s.app, expenseBody(f), s.ana);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ code: 'RATE_LIMITED' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(await countMovements(s.anaId)).toBe(60);

    s.clock.advance(60_000);
    expect((await post(s.app, expenseBody(f), s.ana)).status).toBe(201);
    expect(await countMovements(s.anaId)).toBe(61);
  });

  it('does not count requests that fail validation or answer 4xx, and limits each user apart (AC-28)', async () => {
    const s = await setup({ writeLimit: 3 });
    const f = await fixture(s.anaId);
    for (let i = 0; i < 5; i += 1) {
      expect((await post(s.app, expenseBody(f, { amount: '0' }), s.ana)).status).toBe(400);
      expect(
        (await post(s.app, expenseBody(f, { categoryId: f.incomeCategoryId }), s.ana)).status,
      ).toBe(400);
      expect((await post(s.app, expenseBody(f, { accountId: randomUUID() }), s.ana)).status).toBe(
        404,
      );
    }
    for (let i = 0; i < 3; i += 1) {
      expect((await post(s.app, expenseBody(f), s.ana)).status).toBe(201);
    }
    expect((await post(s.app, expenseBody(f), s.ana)).status).toBe(429);

    const g = await fixture(s.bobId);
    expect((await post(s.app, expenseBody(g), s.bob)).status).toBe(201);
  });

  it('carries the seconds left in the window and exposes Retry-After to browsers (AC-28)', async () => {
    const s = await setup({ writeLimit: 1 });
    const f = await fixture(s.anaId);
    // Move the injected clock to 20 seconds into an epoch-aligned minute.
    const now = s.clock.now().getTime();
    const target = Math.floor(now / 60_000) * 60_000 + 80_000;
    s.clock.advance(target - now);
    expect((await post(s.app, expenseBody(f), s.ana)).status).toBe(201);
    const limited = await post(s.app, expenseBody(f), s.ana);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('40');
    expect(limited.headers['access-control-expose-headers']).toContain('Retry-After');
    expect(limited.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
  });
});

describe('ownership and paging', () => {
  it("answers 404 NOT_FOUND for another user's account, category and movement and lists only the caller's (AC-16, AC-17)", async () => {
    const s = await setup();
    const mine = await fixture(s.anaId);
    const theirs = await fixture(s.bobId);

    const foreignAccount = await post(
      s.app,
      expenseBody(mine, { accountId: theirs.accountId }),
      s.ana,
    );
    expect(foreignAccount.status).toBe(404);
    expect(foreignAccount.body).toEqual({ code: 'NOT_FOUND' });
    const foreignCategory = await post(
      s.app,
      expenseBody(mine, { categoryId: theirs.expenseCategoryId }),
      s.ana,
    );
    expect(foreignCategory.status).toBe(404);
    expect(foreignCategory.body).toEqual({ code: 'NOT_FOUND' });
    expect(await countMovements(s.anaId)).toBe(0);

    const bobs = movementResponseSchema.parse((await post(s.app, expenseBody(theirs), s.bob)).body);
    const foreignGet = await get(s.app, `/movements/${bobs.id}`, s.ana);
    expect(foreignGet.status).toBe(404);
    expect(foreignGet.body).toEqual({ code: 'NOT_FOUND' });
    const missingGet = await get(s.app, `/movements/${randomUUID()}`, s.ana);
    expect(missingGet.status).toBe(404);
    expect(missingGet.body).toEqual(foreignGet.body);

    await post(s.app, expenseBody(mine), s.ana);
    const list = listMovementsResponseSchema.parse((await get(s.app, '/movements', s.ana)).body);
    expect(list.total).toBe(1);
    expect(list.items.every((item) => item.accountId === mine.accountId)).toBe(true);
  });

  it('pages by 50 by default, accepts limit 100 and rejects 101 (AC-14)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    await connection.pool.query(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
       select $1, 'expense', $2, $3, 100, now() - (g || ' minutes')::interval, 14000000, 'manual'
       from generate_series(1, 101) g`,
      [s.anaId, f.accountId, f.expenseCategoryId],
    );
    const first = listMovementsResponseSchema.parse((await get(s.app, '/movements', s.ana)).body);
    expect(first.items).toHaveLength(50);
    expect(first.total).toBe(101);
    const wide = listMovementsResponseSchema.parse(
      (await get(s.app, '/movements?limit=100', s.ana)).body,
    );
    expect(wide.items).toHaveLength(100);
    const second = listMovementsResponseSchema.parse(
      (await get(s.app, '/movements?limit=100&offset=100', s.ana)).body,
    );
    expect(second.items).toHaveLength(1);
    const tooWide = await get(s.app, '/movements?limit=101', s.ana);
    expect(tooWide.status).toBe(400);
    expect(tooWide.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await get(s.app, '/movements/not-a-uuid', s.ana)).status).toBe(400);
  });
});

describe('authentication, request guards and failures', () => {
  const routes: [string, 'get' | 'post', (id: string) => string][] = [
    ['list', 'get', () => '/movements'],
    ['create', 'post', () => '/movements'],
    ['get', 'get', (id) => `/movements/${id}`],
    ['tags', 'get', () => '/tags?prefix=vi'],
  ];

  function call(
    app: Express,
    method: 'get' | 'post',
    path: string,
    cookies?: SessionCookies,
    body: object = {},
  ) {
    const req = request(app)[method](path).set(trustedHeaders);
    if (cookies) req.set('Cookie', cookieHeader(cookies));
    return method === 'post' ? req.send(body) : req.send();
  }

  it.each(routes)('%s answers 401 without a session', async (_name, method, path) => {
    const s = await setup();
    const response = await call(s.app, method, path(randomUUID()));
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
  });

  it.each(routes)(
    '%s answers 403 EMAIL_NOT_VERIFIED for an unverified user',
    async (_name, method, path) => {
      const s = await setup();
      const email = `eve-${randomUUID()}@example.com`;
      await seedUser(connection, { email, password: PASSWORD, verified: false });
      // Reuse the app of this setup: the session of an unverified user is still a session.
      const harnessApp = s.app;
      const eve = sessionFrom(await signIn(harnessApp, email, PASSWORD));
      const response = await call(harnessApp, method, path(randomUUID()), eve);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
    },
  );

  it('refuses a state-changing request without the web origin headers (error path)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const noOrigin = await request(s.app)
      .post('/movements')
      .set('Cookie', cookieHeader(s.ana))
      .send(expenseBody(f));
    expect(noOrigin.status).toBe(403);
    const noHeader = await request(s.app)
      .post('/movements')
      .set('Origin', trustedHeaders.Origin)
      .set('Cookie', cookieHeader(s.ana))
      .send(expenseBody(f));
    expect(noHeader.status).toBe(403);
    expect(await countMovements(s.anaId)).toBe(0);
  });

  it('answers 500 INTERNAL with only { code } when the database fails (error path)', async () => {
    const broken = createDatabase(testDatabaseUrl);
    await broken.pool.end();
    const s = await setup({ db: broken.db });
    const f = await fixture(s.anaId);
    const response = await post(s.app, expenseBody(f), s.ana);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL' });
    const listed = await get(s.app, '/movements', s.ana);
    expect(listed.status).toBe(500);
    expect(listed.body).toEqual({ code: 'INTERNAL' });
  });

  it('logs ids only for a created movement, never amount, note or rate', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await post(
      s.app,
      expenseBody(f, { amount: '987654321', note: 'private note text' }),
      s.ana,
    );
    const id = movementResponseSchema.parse(created.body).id;
    const audit = s.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === 'movement created');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ userId: s.anaId, movementId: id });
    const text = JSON.stringify(audit[0]);
    expect(text).not.toContain('987654321');
    expect(text).not.toContain('private note text');
    expect(text).not.toContain('14000000');
  });
});

describe('tags and filters through the real stack', () => {
  it('creates a movement with tags and lists them (AC-03)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await post(
      s.app,
      expenseBody(f, { tags: ['Viaje', 'viaje', 'Comida'] }),
      s.ana,
    );
    expect(created.status).toBe(201);
    expect(movementResponseSchema.parse(created.body).tags).toEqual(['Viaje', 'Comida']);
    const listed = listMovementsResponseSchema.parse((await get(s.app, '/movements', s.ana)).body);
    expect(listed.items[0]?.tags).toEqual(['Viaje', 'Comida']);
  });

  it('rejects an 11th tag and an empty or 31-character tag and stores nothing (AC-04, AC-06)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`);
    for (const tags of [eleven, [' '], ['x'.repeat(31)]]) {
      const response = await post(s.app, expenseBody(f, { tags }), s.ana);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(JSON.stringify(response.body)).not.toContain('xxxxx');
    }
    expect(await countMovements(s.anaId)).toBe(0);
  });

  it('applies all five filters together (AC-01)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const other = await fixture(s.anaId);
    const at = '2026-03-10T15:00:00.000Z';
    const hit = await post(s.app, expenseBody(f, { tags: ['Viaje'], occurredAt: at }), s.ana);
    const hitId = movementResponseSchema.parse(hit.body).id;
    await post(s.app, expenseBody(f, { tags: ['Otro'], occurredAt: at }), s.ana);
    await post(s.app, expenseBody(f, { occurredAt: at }), s.ana);
    await post(s.app, expenseBody(other, { tags: ['Viaje'], occurredAt: at }), s.ana);
    await post(
      s.app,
      expenseBody(f, { tags: ['Viaje'], occurredAt: '2026-04-20T15:00:00.000Z' }),
      s.ana,
    );
    const query = new URLSearchParams({
      accountId: f.accountId,
      categoryId: f.expenseCategoryId,
      type: 'expense',
      tag: 'viaje',
      from: '2026-03-01',
      to: '2026-03-31',
    });
    const response = await get(s.app, `/movements?${query.toString()}`, s.ana);
    expect(response.status).toBe(200);
    const page = listMovementsResponseSchema.parse(response.body);
    expect(page.total).toBe(1);
    expect(page.items.map((item) => item.id)).toEqual([hitId]);
  });

  it('type discriminates: an income matching every other filter is excluded by type=expense (AC-01)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const at = '2026-03-10T15:00:00.000Z';
    const expense = await post(s.app, expenseBody(f, { tags: ['Viaje'], occurredAt: at }), s.ana);
    const income = await post(
      s.app,
      expenseBody(f, {
        type: 'income',
        categoryId: f.incomeCategoryId,
        tags: ['Viaje'],
        occurredAt: at,
      }),
      s.ana,
    );
    expect(income.status).toBe(201);
    // No categoryId here: an income cannot share a category with an expense, so that filter alone would hide it.
    const base = { accountId: f.accountId, tag: 'viaje', from: '2026-03-01', to: '2026-03-31' };
    const idsFor = async (type: string): Promise<string[]> => {
      const query = new URLSearchParams({ ...base, type });
      const response = await get(s.app, `/movements?${query.toString()}`, s.ana);
      return listMovementsResponseSchema.parse(response.body).items.map((item) => item.id);
    };
    expect(await idsFor('expense')).toEqual([movementResponseSchema.parse(expense.body).id]);
    expect(await idsFor('income')).toEqual([movementResponseSchema.parse(income.body).id]);
  });

  it('reads from and to as days in the callers time zone, not UTC (AC-01)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    // 01:00 UTC on the 11th is 22:00 on the 10th in America/Cordoba (UTC-3).
    const late = await post(
      s.app,
      expenseBody(f, { occurredAt: '2026-03-11T01:00:00.000Z' }),
      s.ana,
    );
    const lateId = movementResponseSchema.parse(late.body).id;
    const ids = async (query: string): Promise<string[]> =>
      listMovementsResponseSchema
        .parse((await get(s.app, `/movements?${query}`, s.ana)).body)
        .items.map((item) => item.id);
    expect(await ids('from=2026-03-10&to=2026-03-10')).toEqual([lateId]);
    expect(await ids('from=2026-03-11&to=2026-03-11')).toEqual([]);
  });

  it('includes the subcategory movements when filtering by the parent category (AC-02)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const child = await connection.pool.query<{ id: string }>(
      `insert into categories (owner_id, kind, name, icon, color, parent_id)
       values ($1, 'expense', $2, 'wallet', 'blue', $3) returning id`,
      [s.anaId, `Sub ${randomUUID()}`, f.expenseCategoryId],
    );
    const childId = child.rows[0]?.id ?? '';
    await post(s.app, expenseBody(f), s.ana);
    await post(s.app, expenseBody(f, { categoryId: childId }), s.ana);
    const page = listMovementsResponseSchema.parse(
      (await get(s.app, `/movements?categoryId=${f.expenseCategoryId}`, s.ana)).body,
    );
    expect(page.total).toBe(2);
  });

  it('answers the same empty body for foreign ids and tags as for a filter matching nothing (AC-07, R-02)', async () => {
    const s = await setup();
    const mine = await fixture(s.anaId);
    const theirs = await fixture(s.bobId);
    await post(s.app, expenseBody(mine, { tags: ['Viaje'] }), s.ana);
    await post(s.app, expenseBody(theirs, { tags: ['Secreto'] }), s.bob);
    const empty = await get(s.app, `/movements?accountId=${randomUUID()}`, s.ana);
    expect(empty.status).toBe(200);
    expect(JSON.parse(empty.text)).toMatchObject({ items: [], total: 0 });
    for (const query of [
      `accountId=${theirs.accountId}`,
      `categoryId=${theirs.expenseCategoryId}`,
      'tag=Secreto',
      `accountId=${theirs.accountId}&categoryId=${theirs.expenseCategoryId}&tag=Secreto`,
    ]) {
      const response = await get(s.app, `/movements?${query}`, s.ana);
      expect(response.status).toBe(200);
      expect(response.text).toBe(empty.text);
    }
  });

  it('rejects invalid filters with 400 and without echoing the value', async () => {
    const s = await setup();
    for (const query of [
      'from=2026-02-30',
      'from=2026-05-02&to=2026-05-01',
      'accountId=secret-x',
      'type=secret-bogus',
      'categoryId=secret-not-a-uuid',
      `tag=${'q'.repeat(31)}`,
    ]) {
      const response = await get(s.app, `/movements?${query}`, s.ana);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(response.text).not.toContain('secret-');
      expect(response.text).not.toContain('qqqqq');
    }
  });

  it('answers 500 INTERNAL and logs no tag or filter value when the repository fails (R-08)', async () => {
    const broken = createDatabase(testDatabaseUrl);
    await broken.pool.end();
    const s = await setup({ db: broken.db });
    const f = await fixture(s.anaId);
    const created = await post(s.app, expenseBody(f, { tags: ['SecretTagName'] }), s.ana);
    expect(created.status).toBe(500);
    expect(created.body).toEqual({ code: 'INTERNAL' });
    const listed = await get(s.app, '/movements?tag=SecretTagName&from=2026-01-01', s.ana);
    expect(listed.status).toBe(500);
    expect(listed.text).toBe('{"code":"INTERNAL"}');
    const suggested = await get(s.app, '/tags?prefix=SecretPrefix', s.ana);
    expect(suggested.status).toBe(500);
    expect(suggested.body).toEqual({ code: 'INTERNAL' });
    const logged = s.lines.join('\n');
    expect(logged).not.toContain('SecretTagName');
    expect(logged).not.toContain('SecretPrefix');
    expect(logged).not.toContain('2026-01-01');
  });

  it('answers 500 INTERNAL and logs no bound value when a query itself fails with an error echoing them (R-08)', async () => {
    const stubbed = createDatabase(testDatabaseUrl);
    const echo = 'driver echo SecretTagName SecretPrefix 2026-01-01';
    // A PostgreSQL data exception (SQLSTATE 22xxx) is the real error that repeats request values.
    const dataException = (): Error =>
      Object.assign(new Error(echo), { code: '22P02', severity: 'ERROR' });
    // Every statement of this handle fails like a driver that repeats the request values.
    Object.assign(stubbed.pool, {
      query: () => Promise.reject(dataException()),
      connect: () => Promise.reject(dataException()),
    });
    const s = await setup({ db: stubbed.db });
    const f = await fixture(s.anaId);
    const responses = [
      await post(s.app, expenseBody(f, { tags: ['SecretTagName'] }), s.ana),
      await get(s.app, '/movements?tag=SecretTagName&from=2026-01-01', s.ana),
      await get(s.app, '/tags?prefix=SecretPrefix', s.ana),
    ];
    for (const response of responses) {
      expect(response.status).toBe(500);
      expect(response.text).toBe('{"code":"INTERNAL"}');
    }
    expect(s.appLines.some((line) => line.includes('"level":50'))).toBe(true);
    const logged = [...s.lines, ...s.appLines].join(' ');
    for (const secret of ['SecretTagName', 'SecretPrefix', '2026-01-01', 'driver echo']) {
      expect(logged).not.toContain(secret);
    }
  });

  it('logs no tag name or prefix for a created movement, a filtered list or a suggestion', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    await post(s.app, expenseBody(f, { tags: ['SecretTagName'] }), s.ana);
    await get(s.app, '/movements?tag=SecretTagName', s.ana);
    await get(s.app, '/tags?prefix=SecretTag', s.ana);
    expect(s.lines.join('\n')).not.toContain('SecretTag');
  });
});
