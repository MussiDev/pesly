import {
  accountResponseSchema,
  listMovementsResponseSchema,
  listRecurringPaymentsResponseSchema,
  recurringPaymentResponseSchema,
  upcomingResponseSchema,
  type RecurringPaymentResponse,
  type UpcomingItem,
} from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAccountRoutes } from '../../src/accounts';
import { createCardAccountLinks } from '../../src/credit-cards';
import {
  createAccountMovements,
  createMovementRoutes,
  createRecurringExpenseRecorder,
} from '../../src/movements';
import { createRecurringRoutes } from '../../src/recurring';
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
import { newCategory } from '../movements/db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

// Recording an expense with the automatic rate needs a stored rate for the default rate type.
beforeEach(async () => {
  await connection.pool.query(
    `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
     values ('mep', 12900000, 13000000, now(), now())
     on conflict (rate_type) do update set buy = excluded.buy, sell = excluded.sell, fetched_at = now()`,
  );
});

const PASSWORD = 'a long enough passphrase';
let sequence = 0;

/** At 16:00 UTC the date is 2026-10-06 in America/Cordoba (UTC-3). */
class MovableClock {
  current = new Date('2026-10-06T16:00:00.000Z');

  now(): Date {
    return this.current;
  }
}

async function setup() {
  sequence += 1;
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const clock = new MovableClock();
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createRecurringRoutes({
        db: connection.db,
        logger,
        expenses: createRecurringExpenseRecorder(connection.db, logger, { clock }),
        clock,
      }),
      createMovementRoutes({ db: connection.db, logger, clock }),
      createAccountRoutes({
        db: connection.db,
        logger,
        movements: createAccountMovements(connection.db),
        links: createCardAccountLinks(connection.db),
      }),
    ],
  });
  const addUser = async (name: string, options: { verified?: boolean; timeZone?: string } = {}) => {
    const email = `${name}-${sequence}@recurring.test`;
    const id = await seedUser(connection, { email, password: PASSWORD, ...options });
    const cookies = sessionFrom(await signIn(harness.app, email, PASSWORD));
    return { id, cookies };
  };
  const ana = await addUser('ana');
  const bob = await addUser('bob');
  const eve = await addUser('eve', { verified: false });
  return { app: harness.app, clock, lines, addUser, ana, bob, eve };
}

type Setup = Awaited<ReturnType<typeof setup>>;
type Method = 'get' | 'post' | 'patch' | 'delete';

function call(
  app: Express,
  method: Method,
  path: string,
  cookies?: Partial<SessionCookies>,
  body?: Record<string, unknown>,
) {
  const req = request(app)[method](path).set(trustedHeaders);
  if (cookies) req.set('Cookie', cookieHeader(cookies));
  return method === 'get' || method === 'delete' ? req : req.send(body ?? {});
}

interface Owner {
  id: string;
  cookies: SessionCookies;
}

/** An ARS cash account (through the accounts route) and an expense category for `owner`. */
async function fixtureOf(s: Setup, owner: Owner) {
  const created = await call(s.app, 'post', '/accounts', owner.cookies, {
    name: 'Caja',
    type: 'cash',
    currency: 'ARS',
  });
  expect(created.status).toBe(201);
  const accountId = accountResponseSchema.parse(created.body).id;
  const categoryId = await newCategory(connection.pool, owner.id, 'expense');
  return { accountId, categoryId };
}

const rentBody = (
  fixture: { accountId: string; categoryId: string },
  over: Record<string, unknown> = {},
) => ({
  name: 'Rent',
  amount: '35000000',
  accountId: fixture.accountId,
  categoryId: fixture.categoryId,
  frequency: 'monthly',
  dayOfMonth: 6,
  startDate: '2026-10-06',
  mode: 'confirmation',
  ...over,
});

async function createPayment(
  s: Setup,
  owner: Owner,
  body: Record<string, unknown>,
): Promise<RecurringPaymentResponse> {
  const response = await call(s.app, 'post', '/recurring/payments', owner.cookies, body);
  expect(response.status).toBe(201);
  return recurringPaymentResponseSchema.parse(response.body);
}

async function upcomingOf(s: Setup, owner: Owner): Promise<UpcomingItem[]> {
  const response = await call(s.app, 'get', '/recurring/upcoming', owner.cookies);
  expect(response.status).toBe(200);
  return upcomingResponseSchema.parse(response.body).items;
}

async function movementsOf(s: Setup, owner: Owner) {
  const response = await call(s.app, 'get', '/movements', owner.cookies);
  expect(response.status).toBe(200);
  return listMovementsResponseSchema.parse(response.body).items;
}

async function balanceOf(s: Setup, owner: Owner, accountId: string): Promise<string> {
  const response = await call(s.app, 'get', `/accounts/${accountId}`, owner.cookies);
  return accountResponseSchema.parse(response.body).balance;
}

async function paymentsOf(s: Setup, owner: Owner) {
  const response = await call(s.app, 'get', '/recurring/payments', owner.cookies);
  expect(response.status).toBe(200);
  return listRecurringPaymentsResponseSchema.parse(response.body).items;
}

const pendingOf = async (s: Setup, owner: Owner) => {
  const item = (await upcomingOf(s, owner)).find((entry) => entry.kind === 'pending');
  if (!item?.occurrenceId) throw new Error('No pending item');
  return item.occurrenceId;
};

describe('create and list', () => {
  it('creates "Rent" with 201 and lists it with its next due date (AC-01)', async () => {
    const s = await setup();
    const fixture = await fixtureOf(s, s.ana);
    const created = await createPayment(
      s,
      s.ana,
      rentBody(fixture, { dayOfMonth: 5, startDate: '2026-11-05' }),
    );

    expect(created).toMatchObject({
      name: 'Rent',
      amount: '35000000',
      status: 'active',
      nextDueDate: '2026-11-05',
    });
    expect(await paymentsOf(s, s.ana)).toEqual([created]);
    const one = await call(s.app, 'get', `/recurring/payments/${created.id}`, s.ana.cookies);
    expect(one.status).toBe(200);
    expect(one.body).toEqual(created);
  });

  it('logs ids only: never the name or the amount', async () => {
    const s = await setup();
    const fixture = await fixtureOf(s, s.ana);
    await createPayment(s, s.ana, rentBody(fixture, { name: 'Secret landlord' }));
    const log = s.lines.join('\n');
    expect(log).not.toContain('Secret landlord');
    expect(log).not.toContain('35000000');
  });

  it.each([
    ['amount 0', { amount: '0' }],
    ['a negative amount', { amount: '-5' }],
    ['a decimal amount', { amount: '1.5' }],
    ['an empty name', { name: '' }],
    ['end before start', { endDate: '2026-10-01' }],
    ['a reminder-style unknown field', { reminderDaysBefore: 3 }],
    ['an unknown frequency', { frequency: 'daily' }],
    ['a monthly rule without dayOfMonth', { dayOfMonth: undefined }],
  ])('answers 400 for %s and stores nothing (AC-02, NFR-04)', async (_label, over) => {
    const s = await setup();
    const fixture = await fixtureOf(s, s.ana);
    const response = await call(
      s.app,
      'post',
      '/recurring/payments',
      s.ana.cookies,
      rentBody(fixture, over),
    );
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await paymentsOf(s, s.ana)).toEqual([]);
  });

  it("answers 404 for another user's account or category and stores nothing (AC-17)", async () => {
    const s = await setup();
    const mine = await fixtureOf(s, s.ana);
    const theirs = await fixtureOf(s, s.bob);
    for (const over of [{ accountId: theirs.accountId }, { categoryId: theirs.categoryId }]) {
      const response = await call(
        s.app,
        'post',
        '/recurring/payments',
        s.ana.cookies,
        rentBody(mine, over),
      );
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ code: 'NOT_FOUND' });
    }
    expect(await paymentsOf(s, s.ana)).toEqual([]);
  });

  it("answers 404 when a PATCH points at another user's account", async () => {
    const s = await setup();
    const mine = await fixtureOf(s, s.ana);
    const theirs = await fixtureOf(s, s.bob);
    const payment = await createPayment(s, s.ana, rentBody(mine));
    const response = await call(
      s.app,
      'patch',
      `/recurring/payments/${payment.id}`,
      s.ana.cookies,
      { accountId: theirs.accountId },
    );
    expect(response.status).toBe(404);
    expect((await paymentsOf(s, s.ana))[0]?.accountId).toBe(mine.accountId);
  });
});

describe('input validation on every route (NFR-04)', () => {
  const UUID = '00000000-0000-4000-8000-000000000000';
  const routes: [Method, string, Record<string, unknown>?][] = [
    ['get', '/recurring/payments/not-a-uuid'],
    ['patch', '/recurring/payments/not-a-uuid', { name: 'x' }],
    ['patch', `/recurring/payments/${UUID}`, { frequency: 'daily' }],
    ['patch', `/recurring/payments/${UUID}`, {}],
    ['post', '/recurring/payments/not-a-uuid/pause'],
    ['post', '/recurring/payments/not-a-uuid/resume'],
    ['delete', '/recurring/payments/not-a-uuid'],
    ['post', '/recurring/occurrences/not-a-uuid/confirm', {}],
    ['post', `/recurring/occurrences/${UUID}/confirm`, { amount: '0' }],
    ['post', `/recurring/occurrences/${UUID}/confirm`, { date: '2026-02-31' }],
    ['post', `/recurring/occurrences/${UUID}/confirm`, { extra: 1 }],
    ['post', '/recurring/occurrences/not-a-uuid/skip', {}],
  ];

  it.each(routes)('%s %s answers 400 and changes nothing', async (method, path, body) => {
    const s = await setup();
    const fixture = await fixtureOf(s, s.ana);
    const payment = await createPayment(s, s.ana, rentBody(fixture));
    const before = await upcomingOf(s, s.ana);

    const response = await call(s.app, method, path, s.ana.cookies, body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await paymentsOf(s, s.ana)).toEqual([payment]);
    expect(await upcomingOf(s, s.ana)).toEqual(before);
    expect(await movementsOf(s, s.ana)).toEqual([]);
  });
});

describe('upcoming, confirm and skip', () => {
  it('returns one pending item on the due date however many times it is read, balances untouched (AC-06)', async () => {
    const s = await setup();
    const fixture = await fixtureOf(s, s.ana);
    await createPayment(s, s.ana, rentBody(fixture));
    const before = await balanceOf(s, s.ana, fixture.accountId);

    const first = await upcomingOf(s, s.ana);
    const second = await upcomingOf(s, s.ana);

    expect(first.filter((item) => item.kind === 'pending')).toHaveLength(1);
    expect(second).toEqual(first);
    expect(await balanceOf(s, s.ana, fixture.accountId)).toBe(before);
    expect(await movementsOf(s, s.ana)).toEqual([]);
  });

  it('confirms with an edited amount, records the expense, and rejects a second confirm (AC-07, AC-08)', async () => {
    const s = await setup();
    const fixture = await fixtureOf(s, s.ana);
    await createPayment(s, s.ana, rentBody(fixture));
    const occurrenceId = await pendingOf(s, s.ana);

    const confirmed = await call(
      s.app,
      'post',
      `/recurring/occurrences/${occurrenceId}/confirm`,
      s.ana.cookies,
      { amount: '4825000' },
    );

    expect(confirmed.status).toBe(200);
    const movements = await movementsOf(s, s.ana);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: 'expense',
      amount: '4825000',
      accountId: fixture.accountId,
      categoryId: fixture.categoryId,
    });
    expect(await balanceOf(s, s.ana, fixture.accountId)).toBe('-4825000');
    expect((await upcomingOf(s, s.ana)).some((item) => item.kind === 'pending')).toBe(false);

    const again = await call(
      s.app,
      'post',
      `/recurring/occurrences/${occurrenceId}/confirm`,
      s.ana.cookies,
      {},
    );
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ code: 'RECURRING_OCCURRENCE_NOT_PENDING' });
    expect(await movementsOf(s, s.ana)).toHaveLength(1);
  });

  it('answers 409 ACCOUNT_ARCHIVED on an archived account and leaves the occurrence pending (AC-08)', async () => {
    const s = await setup();
    const fixture = await fixtureOf(s, s.ana);
    await createPayment(s, s.ana, rentBody(fixture));
    const occurrenceId = await pendingOf(s, s.ana);
    await connection.pool.query('update accounts set archived_at = now() where id = $1', [
      fixture.accountId,
    ]);

    const response = await call(
      s.app,
      'post',
      `/recurring/occurrences/${occurrenceId}/confirm`,
      s.ana.cookies,
      {},
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_ARCHIVED' });
    expect(await pendingOf(s, s.ana)).toBe(occurrenceId);
    expect(await movementsOf(s, s.ana)).toEqual([]);
  });

  it('skips with 200, records nothing and never brings the date back (AC-09)', async () => {
    const s = await setup();
    const fixture = await fixtureOf(s, s.ana);
    await createPayment(s, s.ana, rentBody(fixture));
    const occurrenceId = await pendingOf(s, s.ana);

    const skipped = await call(
      s.app,
      'post',
      `/recurring/occurrences/${occurrenceId}/skip`,
      s.ana.cookies,
    );

    expect(skipped.status).toBe(200);
    expect(await movementsOf(s, s.ana)).toEqual([]);
    expect((await upcomingOf(s, s.ana)).some((item) => item.kind === 'pending')).toBe(false);
    const again = await call(
      s.app,
      'post',
      `/recurring/occurrences/${occurrenceId}/skip`,
      s.ana.cookies,
    );
    expect(again.status).toBe(409);
  });

  it('returns overdue, pending and scheduled items in date order with the right kind (AC-10, AC-11)', async () => {
    const s = await setup();
    const fixture = await fixtureOf(s, s.ana);
    await createPayment(
      s,
      s.ana,
      rentBody(fixture, { name: 'Past', dayOfMonth: 4, startDate: '2026-10-04' }),
    );
    await createPayment(s, s.ana, rentBody(fixture, { name: 'Today' }));

    const items = await upcomingOf(s, s.ana);

    expect(items.map((item) => [item.name, item.kind, item.dueDate])).toEqual([
      ['Past', 'overdue', '2026-10-04'],
      ['Today', 'pending', '2026-10-06'],
      ['Past', 'scheduled', '2026-11-04'],
    ]);
    expect(items.map((item) => item.occurrenceId === null)).toEqual([false, false, true]);
  });

  it('shows a payment due the next day in Asia/Tokyo as due today at 16:30 UTC (AC-16)', async () => {
    const s = await setup();
    const tokyo = await s.addUser('kenji', { timeZone: 'Asia/Tokyo' });
    const fixture = await fixtureOf(s, tokyo);
    s.clock.current = new Date('2026-10-31T16:30:00.000Z');
    await createPayment(
      s,
      tokyo,
      rentBody(fixture, { dayOfMonth: 1, startDate: '2026-11-01', name: 'Tokyo rent' }),
    );

    const items = await upcomingOf(s, tokyo);

    expect(items[0]).toMatchObject({ kind: 'pending', dueDate: '2026-11-01' });
  });
});

describe('edit, pause, resume, delete', () => {
  it('PATCH amount changes what the upcoming items carry (AC-12)', async () => {
    const s = await setup();
    const fixture = await fixtureOf(s, s.ana);
    const payment = await createPayment(s, s.ana, rentBody(fixture));

    const patched = await call(s.app, 'patch', `/recurring/payments/${payment.id}`, s.ana.cookies, {
      amount: '40000000',
    });

    expect(patched.status).toBe(200);
    expect(recurringPaymentResponseSchema.parse(patched.body).amount).toBe('40000000');
    const items = await upcomingOf(s, s.ana);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.amount === '40000000')).toBe(true);
  });

  it('pause removes the payment from upcoming and resume does not backfill (AC-13, AC-14)', async () => {
    const s = await setup();
    const fixture = await fixtureOf(s, s.ana);
    const payment = await createPayment(
      s,
      s.ana,
      rentBody(fixture, { dayOfMonth: 8, startDate: '2026-10-08' }),
    );

    const paused = await call(
      s.app,
      'post',
      `/recurring/payments/${payment.id}/pause`,
      s.ana.cookies,
    );
    expect(paused.status).toBe(200);
    expect(recurringPaymentResponseSchema.parse(paused.body)).toMatchObject({
      status: 'paused',
      nextDueDate: null,
    });
    expect(await upcomingOf(s, s.ana)).toEqual([]);

    s.clock.current = new Date('2026-10-20T16:00:00.000Z');
    const resumed = await call(
      s.app,
      'post',
      `/recurring/payments/${payment.id}/resume`,
      s.ana.cookies,
    );
    expect(resumed.status).toBe(200);
    expect(recurringPaymentResponseSchema.parse(resumed.body)).toMatchObject({
      status: 'active',
      nextDueDate: '2026-11-08',
    });
    expect((await upcomingOf(s, s.ana)).some((item) => item.kind === 'overdue')).toBe(false);
  });

  it('DELETE answers 204, drops the occurrences and keeps recorded movements (AC-15)', async () => {
    const s = await setup();
    const fixture = await fixtureOf(s, s.ana);
    const payment = await createPayment(s, s.ana, rentBody(fixture));
    const occurrenceId = await pendingOf(s, s.ana);
    await call(s.app, 'post', `/recurring/occurrences/${occurrenceId}/confirm`, s.ana.cookies, {});

    const deleted = await call(s.app, 'delete', `/recurring/payments/${payment.id}`, s.ana.cookies);

    expect(deleted.status).toBe(204);
    expect(await paymentsOf(s, s.ana)).toEqual([]);
    expect(await upcomingOf(s, s.ana)).toEqual([]);
    expect(await movementsOf(s, s.ana)).toHaveLength(1);
  });
});

describe('ownership and authentication', () => {
  it("answers 404 with the missing-id body on every route for another user's ids (AC-17, AC-18)", async () => {
    const s = await setup();
    const fixture = await fixtureOf(s, s.bob);
    const payment = await createPayment(s, s.bob, rentBody(fixture));
    const occurrenceId = await pendingOf(s, s.bob);
    const missing = '00000000-0000-4000-8000-000000000000';
    const routes: [Method, (id: string) => string, Record<string, unknown>?][] = [
      ['get', (id) => `/recurring/payments/${id}`],
      ['patch', (id) => `/recurring/payments/${id}`, { name: 'Hijack' }],
      ['post', (id) => `/recurring/payments/${id}/pause`],
      ['post', (id) => `/recurring/payments/${id}/resume`],
      ['delete', (id) => `/recurring/payments/${id}`],
    ];

    for (const [method, path, body] of routes) {
      const foreign = await call(s.app, method, path(payment.id), s.ana.cookies, body);
      const absent = await call(s.app, method, path(missing), s.ana.cookies, body);
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(absent.body);
    }
    for (const action of ['confirm', 'skip']) {
      const foreign = await call(
        s.app,
        'post',
        `/recurring/occurrences/${occurrenceId}/${action}`,
        s.ana.cookies,
        {},
      );
      const absent = await call(
        s.app,
        'post',
        `/recurring/occurrences/${missing}/${action}`,
        s.ana.cookies,
        {},
      );
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(absent.body);
    }

    expect(await paymentsOf(s, s.bob)).toEqual([payment]);
    expect(await pendingOf(s, s.bob)).toBe(occurrenceId);
    expect(await movementsOf(s, s.bob)).toEqual([]);
    expect(await paymentsOf(s, s.ana)).toEqual([]);
    expect(await upcomingOf(s, s.ana)).toEqual([]);
  });

  it('answers 401 without a session and 403 before the email is verified (AC-17)', async () => {
    const s = await setup();
    for (const [method, path] of [
      ['get', '/recurring/payments'],
      ['get', '/recurring/upcoming'],
      ['post', '/recurring/payments'],
    ] as const) {
      expect((await call(s.app, method, path)).status).toBe(401);
      const unverified = await call(s.app, method, path, s.eve.cookies, {});
      expect(unverified.status).toBe(403);
      expect(unverified.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
    }
  });

  it('refuses a state-changing request without the trusted headers (AC-17)', async () => {
    const s = await setup();
    const fixture = await fixtureOf(s, s.ana);
    const response = await request(s.app)
      .post('/recurring/payments')
      .set('Cookie', cookieHeader(s.ana.cookies))
      .send(rentBody(fixture));
    expect(response.status).toBe(403);
    expect(await paymentsOf(s, s.ana)).toEqual([]);
  });
});
