import { randomUUID } from 'node:crypto';
import { movementResponseSchema, type MovementResponse } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountRoutes } from '../../src/accounts';
import { createAccountMovements, createMovementRoutes } from '../../src/movements';
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
import { trustedHeaders } from '../helpers/test-env';
import { newAccount, newCategory } from './db-fixtures';

/** PUT and DELETE /movements/:id through the real stack (spec 03e, Block 5). */

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';

interface Setup {
  app: Express;
  ana: SessionCookies;
  bob: SessionCookies;
  anaId: string;
  bobId: string;
  /** Lines of the movements logger. */
  lines: string[];
  /** Lines of the app logger, where the error middleware writes. */
  appLines: string[];
}

async function setup(): Promise<Setup> {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const { db } = connection;
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createAccountRoutes({ db, logger, movements: createAccountMovements(db) }),
      createMovementRoutes({ db, logger, clock: new MutableClock() }),
    ],
  });
  const suffix = randomUUID();
  const anaEmail = `ana-${suffix}@example.com`;
  const bobEmail = `bob-${suffix}@example.com`;
  const anaId = await seedUser(connection, { email: anaEmail, password: PASSWORD });
  const bobId = await seedUser(connection, { email: bobEmail, password: PASSWORD });
  const ana = sessionFrom(await signIn(harness.app, anaEmail, PASSWORD));
  const bob = sessionFrom(await signIn(harness.app, bobEmail, PASSWORD));
  return { app: harness.app, ana, bob, anaId, bobId, lines, appLines: harness.lines };
}

const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();
const hoursAhead = (hours: number): string =>
  new Date(Date.now() + hours * 3_600_000).toISOString();

function put(app: Express, id: string, body: unknown, cookies: SessionCookies) {
  return request(app)
    .put(`/movements/${id}`)
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(cookies))
    .send(body as object);
}

function del(app: Express, id: string, cookies: SessionCookies) {
  return request(app)
    .delete(`/movements/${id}`)
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(cookies));
}

function getJson(app: Express, path: string, cookies: SessionCookies) {
  return request(app).get(path).set('Cookie', cookieHeader(cookies));
}

async function create(s: Setup, body: Record<string, unknown>): Promise<MovementResponse> {
  const response = await request(s.app)
    .post('/movements')
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(s.ana))
    .send(body);
  expect(response.status).toBe(201);
  return movementResponseSchema.parse(response.body);
}

async function balanceOf(s: Setup, accountId: string): Promise<string> {
  const response = await getJson(s.app, `/accounts/${accountId}`, s.ana);
  expect(response.status).toBe(200);
  return (response.body as { balance: string }).balance;
}

async function stored(s: Setup, id: string): Promise<MovementResponse> {
  const response = await getJson(s.app, `/movements/${id}`, s.ana);
  expect(response.status).toBe(200);
  return movementResponseSchema.parse(response.body);
}

interface Fixture {
  ars1: string;
  ars2: string;
  usd1: string;
  expenseCategory: string;
  otherExpenseCategory: string;
}

async function fixture(ownerId: string): Promise<Fixture> {
  const { pool } = connection;
  return {
    ars1: await newAccount(pool, ownerId),
    ars2: await newAccount(pool, ownerId),
    usd1: await newAccount(pool, ownerId, false, 'USD'),
    expenseCategory: await newCategory(pool, ownerId, 'expense'),
    otherExpenseCategory: await newCategory(pool, ownerId, 'expense'),
  };
}

function expenseBody(f: Fixture, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'expense',
    accountId: f.ars1,
    categoryId: f.expenseCategory,
    amount: '150000',
    occurredAt: hoursAgo(2),
    rate: { source: 'manual', value: '14000000' },
    ...overrides,
  };
}

describe('PUT /movements/:id', () => {
  it('changes amount, date, account, category, note, tags and rate and the balances follow (AC-01)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await create(s, expenseBody(f, { note: 'first', tags: ['a'] }));
    expect(await balanceOf(s, f.ars1)).toBe('-150000');

    const when = hoursAgo(30);
    const response = await put(
      s.app,
      created.id,
      expenseBody(f, {
        accountId: f.ars2,
        categoryId: f.otherExpenseCategory,
        amount: '90000',
        occurredAt: when,
        note: 'edited',
        tags: ['b', 'c'],
        rate: { source: 'manual', value: '15000000' },
      }),
      s.ana,
    );

    expect(response.status).toBe(200);
    const updated = movementResponseSchema.parse(response.body);
    expect(updated).toMatchObject({
      id: created.id,
      accountId: f.ars2,
      categoryId: f.otherExpenseCategory,
      amount: '90000',
      occurredAt: when,
      note: 'edited',
      tags: ['b', 'c'],
      rate: '15000000',
      rateSource: 'manual',
      createdAt: created.createdAt,
    });
    expect(await stored(s, created.id)).toEqual(updated);
    expect(await balanceOf(s, f.ars1)).toBe('0');
    expect(await balanceOf(s, f.ars2)).toBe('-90000');
  });

  it('keeps the frozen rate with keep and clears the note and tags that the body omits (AC-01)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await create(s, expenseBody(f, { note: 'first', tags: ['a'] }));

    const response = await put(
      s.app,
      created.id,
      expenseBody(f, { amount: '1', rate: { source: 'keep' } }),
      s.ana,
    );

    expect(response.status).toBe(200);
    expect(movementResponseSchema.parse(response.body)).toMatchObject({
      amount: '1',
      rate: '14000000',
      rateSource: 'manual',
      rateType: null,
      note: null,
      tags: [],
    });
  });

  it('recomputes the balances of both accounts of a transfer and of an exchange (AC-01)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const transfer = await create(s, {
      type: 'transfer',
      accountId: f.ars1,
      destinationAccountId: f.ars2,
      amount: '5000',
      occurredAt: hoursAgo(3),
    });
    expect([await balanceOf(s, f.ars1), await balanceOf(s, f.ars2)]).toEqual(['-5000', '5000']);

    const sent = await put(
      s.app,
      transfer.id,
      {
        type: 'transfer',
        accountId: f.ars1,
        destinationAccountId: f.ars2,
        amount: '8000',
        occurredAt: hoursAgo(3),
      },
      s.ana,
    );
    expect(sent.status).toBe(200);
    expect([await balanceOf(s, f.ars1), await balanceOf(s, f.ars2)]).toEqual(['-8000', '8000']);

    const exchange = await create(s, {
      type: 'exchange',
      accountId: f.ars1,
      destinationAccountId: f.usd1,
      amount: '155730000',
      destinationAmount: '100000',
      occurredAt: hoursAgo(3),
    });
    const changed = await put(
      s.app,
      exchange.id,
      {
        type: 'exchange',
        accountId: f.ars1,
        destinationAccountId: f.usd1,
        amount: '300000000',
        destinationAmount: '200000',
        occurredAt: hoursAgo(3),
      },
      s.ana,
    );
    expect(changed.status).toBe(200);
    expect(movementResponseSchema.parse(changed.body)).toMatchObject({
      rate: '15000000',
      rateSource: 'implied',
    });
    expect(await balanceOf(s, f.usd1)).toBe('200000');
    expect(await balanceOf(s, f.ars1)).toBe('-300008000');
  });

  it('answers 404 for a movement of another user, with the body of a random id, and changes nothing (AC-03)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await create(s, expenseBody(f));

    const foreign = await put(s.app, created.id, expenseBody(f, { amount: '9' }), s.bob);
    const missing = await put(s.app, randomUUID(), expenseBody(f, { amount: '9' }), s.bob);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ code: 'NOT_FOUND' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(foreign.body);
    expect((await stored(s, created.id)).amount).toBe('150000');
  });

  it('answers 404 before a type error for a foreign id, so the type is not probed (AC-03)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await create(s, expenseBody(f));

    const probe = await put(
      s.app,
      created.id,
      {
        type: 'transfer',
        accountId: f.ars1,
        destinationAccountId: f.ars2,
        amount: '1',
        occurredAt: hoursAgo(1),
      },
      s.bob,
    );

    expect(probe.status).toBe(404);
    expect(probe.body).toEqual({ code: 'NOT_FOUND' });
  });

  it('rejects a date after today in the user time zone with 400 and changes nothing (AC-04)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await create(s, expenseBody(f));

    const response = await put(
      s.app,
      created.id,
      expenseBody(f, { occurredAt: hoursAhead(48) }),
      s.ana,
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ code: 'MOVEMENT_DATE_IN_FUTURE' });
    expect((await stored(s, created.id)).occurredAt).toBe(created.occurredAt);
  });

  it('rejects an amount of 0 or below with 400 VALIDATION_FAILED and changes nothing (AC-05)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await create(s, expenseBody(f));

    for (const amount of ['0', '-5']) {
      const response = await put(s.app, created.id, expenseBody(f, { amount }), s.ana);
      expect(response.status, amount).toBe(400);
      expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
      expect((response.body as { fields: string[] }).fields).toContain('body.amount');
    }
    expect((await stored(s, created.id)).amount).toBe('150000');
  });

  it('rejects a different type with 409 and a malformed id with 400 (FR-01)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await create(s, expenseBody(f));

    const typeChange = await put(
      s.app,
      created.id,
      {
        type: 'transfer',
        accountId: f.ars1,
        destinationAccountId: f.ars2,
        amount: '1',
        occurredAt: hoursAgo(1),
      },
      s.ana,
    );
    const badId = await put(s.app, 'not-a-uuid', expenseBody(f), s.ana);

    expect(typeChange.status).toBe(409);
    expect(typeChange.body).toEqual({ code: 'MOVEMENT_TYPE_IMMUTABLE' });
    expect(badId.status).toBe(400);
    expect((badId.body as { code: string }).code).toBe('VALIDATION_FAILED');
    expect((await stored(s, created.id)).type).toBe('expense');
  });

  it('rejects an account of another user with 404 and keeps the movement where it was (AC-03)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await create(s, expenseBody(f));
    const bobsAccount = await newAccount(connection.pool, s.bobId);

    const response = await put(
      s.app,
      created.id,
      expenseBody(f, { accountId: bobsAccount }),
      s.ana,
    );

    expect(response.status).toBe(404);
    expect((await stored(s, created.id)).accountId).toBe(f.ars1);
  });

  it('strips ownerId, id and createdAt from the body instead of writing them (FR-03)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await create(s, expenseBody(f));

    const response = await put(
      s.app,
      created.id,
      expenseBody(f, {
        amount: '77',
        ownerId: s.bobId,
        id: randomUUID(),
        createdAt: '2020-01-01T00:00:00.000Z',
      }),
      s.ana,
    );

    expect(response.status).toBe(200);
    const updated = movementResponseSchema.parse(response.body);
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    const row = await connection.pool.query<{ owner_id: string }>(
      'select owner_id from movements where id = $1',
      [created.id],
    );
    expect(row.rows[0]?.owner_id).toBe(s.anaId);
  });
});

describe('DELETE /movements/:id', () => {
  it('answers 204, removes the movement and reverses the balances (AC-02)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await create(s, expenseBody(f, { tags: ['a'] }));
    const moved = await create(s, {
      type: 'transfer',
      accountId: f.ars1,
      destinationAccountId: f.ars2,
      amount: '5000',
      occurredAt: hoursAgo(1),
    });
    expect(await balanceOf(s, f.ars1)).toBe('-155000');

    const first = await del(s.app, created.id, s.ana);
    const second = await del(s.app, moved.id, s.ana);

    expect(first.status).toBe(204);
    expect(first.text).toBe('');
    expect(second.status).toBe(204);
    expect(await balanceOf(s, f.ars1)).toBe('0');
    expect(await balanceOf(s, f.ars2)).toBe('0');
    expect((await getJson(s.app, `/movements/${created.id}`, s.ana)).status).toBe(404);
  });

  it('answers 404 for another user and for a deleted movement, and 400 for a malformed id (AC-03)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await create(s, expenseBody(f));

    const foreign = await del(s.app, created.id, s.bob);
    const missing = await del(s.app, randomUUID(), s.bob);
    const badId = await del(s.app, 'not-a-uuid', s.ana);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ code: 'NOT_FOUND' });
    expect(missing.body).toEqual(foreign.body);
    expect(badId.status).toBe(400);
    expect((await stored(s, created.id)).amount).toBe('150000');
    expect((await del(s.app, created.id, s.ana)).status).toBe(204);
    expect((await del(s.app, created.id, s.ana)).status).toBe(404);
  });
});

describe('access rules shared by PUT and DELETE', () => {
  it('answers 401 without a session on both routes (FR-03)', async () => {
    const s = await setup();
    const id = randomUUID();

    const putResponse = await request(s.app).put(`/movements/${id}`).set(trustedHeaders).send({});
    const delResponse = await request(s.app).delete(`/movements/${id}`).set(trustedHeaders);

    expect(putResponse.status).toBe(401);
    expect(putResponse.body).toEqual({ code: 'UNAUTHENTICATED' });
    expect(delResponse.status).toBe(401);
    expect(delResponse.body).toEqual({ code: 'UNAUTHENTICATED' });
  });

  it('answers 403 EMAIL_NOT_VERIFIED for an unverified user on both routes (FR-03)', async () => {
    const s = await setup();
    const email = `eve-${randomUUID()}@example.com`;
    await seedUser(connection, { email, password: PASSWORD, verified: false });
    const eve = sessionFrom(await signIn(s.app, email, PASSWORD));
    const id = randomUUID();

    const putResponse = await put(s.app, id, {}, eve);
    const delResponse = await del(s.app, id, eve);

    expect(putResponse.status).toBe(403);
    expect(putResponse.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
    expect(delResponse.status).toBe(403);
    expect(delResponse.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('refuses PUT and DELETE without the web origin headers with 403 and changes nothing (FR-03)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await create(s, expenseBody(f));

    const putResponse = await request(s.app)
      .put(`/movements/${created.id}`)
      .set('Cookie', cookieHeader(s.ana))
      .send(expenseBody(f, { amount: '1' }));
    const delResponse = await request(s.app)
      .delete(`/movements/${created.id}`)
      .set('Cookie', cookieHeader(s.ana));

    expect(putResponse.status).toBe(403);
    expect(delResponse.status).toBe(403);
    expect((await stored(s, created.id)).amount).toBe('150000');
  });
});

describe('logging of PUT and DELETE', () => {
  it('logs the movement id and never the amount, note, rate or tags, also when the request is rejected (FR-01)', async () => {
    const s = await setup();
    const f = await fixture(s.anaId);
    const created = await create(s, expenseBody(f));
    const secret = expenseBody(f, {
      amount: '987654321',
      note: 'private note text',
      tags: ['SecretTag'],
      rate: { source: 'manual', value: '16543210' },
    });

    expect((await put(s.app, created.id, secret, s.ana)).status).toBe(200);
    expect((await put(s.app, created.id, { ...secret, amount: '0' }, s.ana)).status).toBe(400);
    expect((await del(s.app, created.id, s.ana)).status).toBe(204);

    const entries = s.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const updated = entries.filter((entry) => entry.msg === 'movement updated');
    const deleted = entries.filter((entry) => entry.msg === 'movement deleted');
    expect(updated).toHaveLength(1);
    expect(deleted).toHaveLength(1);
    expect(updated[0]).toMatchObject({ userId: s.anaId, movementId: created.id });
    expect(deleted[0]).toMatchObject({ userId: s.anaId, movementId: created.id });
    const everything = [...s.lines, ...s.appLines].join('\n');
    for (const value of ['987654321', 'private note text', 'SecretTag', '16543210']) {
      expect(everything).not.toContain(value);
    }
  });
});
