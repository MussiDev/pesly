import { randomUUID } from 'node:crypto';
import { accountResponseSchema } from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccountLinks } from '../../src/accounts/application/ports/account-links';
import type { AccountMovements } from '../../src/accounts/application/ports/account-movements';
import { createAccountRoutes } from '../../src/accounts';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness, type IdentityHarness } from '../helpers/identity-harness';
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
const ANA = 'ana@example.com';
const BOB = 'bob@example.com';

/** Test movements adapter: sums and "has movements" are set per account id. */
class TestMovements implements AccountMovements {
  readonly sums = new Map<string, bigint>();
  readonly withMovements = new Set<string>();

  sumsByAccount(ids: readonly string[]): Promise<ReadonlyMap<string, bigint>> {
    const result = new Map<string, bigint>();
    for (const id of ids) {
      const sum = this.sums.get(id);
      if (sum !== undefined) result.set(id, sum);
    }
    return Promise.resolve(result);
  }

  hasMovements(id: string): Promise<boolean> {
    return Promise.resolve(this.withMovements.has(id));
  }
}

interface Setup {
  harness: IdentityHarness;
  app: Express;
  ana: SessionCookies;
  bob: SessionCookies;
  anaId: string;
  lines: string[];
}

async function setup(movements?: AccountMovements, links?: AccountLinks): Promise<Setup> {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const routes = createAccountRoutes({
    db: connection.db,
    logger,
    ...(movements ? { movements } : {}),
    ...(links ? { links } : {}),
  });
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [routes],
  });
  const anaId = await seedUser(connection, { email: ANA, password: PASSWORD });
  await seedUser(connection, { email: BOB, password: PASSWORD });
  const ana = sessionFrom(await signIn(harness.app, ANA, PASSWORD));
  const bob = sessionFrom(await signIn(harness.app, BOB, PASSWORD));
  return { harness, app: harness.app, ana, bob, anaId, lines };
}

function get(app: Express, path: string, cookies?: Partial<SessionCookies>) {
  const call = request(app).get(path);
  if (cookies) call.set('Cookie', cookieHeader(cookies));
  return call;
}

function send(
  app: Express,
  method: 'post' | 'patch' | 'delete' | 'put',
  path: string,
  cookies?: Partial<SessionCookies>,
  body?: Record<string, unknown>,
) {
  const call = request(app)[method](path).set(trustedHeaders);
  if (cookies) call.set('Cookie', cookieHeader(cookies));
  return call.send(body);
}

const valid = { name: 'Caja', type: 'cash', currency: 'ARS' };

async function create(
  s: Setup,
  overrides: Record<string, unknown> = {},
  cookies: SessionCookies = s.ana,
): Promise<string> {
  const response = await send(s.app, 'post', '/accounts', cookies, { ...valid, ...overrides });
  expect(response.status).toBe(201);
  return accountResponseSchema.parse(response.body).id;
}

interface ListBody {
  items: {
    id: string;
    name: string;
    balance: string;
    openingBalance: string;
    includeInAvailable: boolean;
  }[];
  availableTotals: { ARS: string; USD: string };
  netWorthTotals: { ARS: string; USD: string };
  debtTotals: { ARS: string; USD: string };
  creditCardCount: number;
  total: number;
  limit: number;
  offset: number;
}

async function list(s: Setup, query = '', cookies: SessionCookies = s.ana): Promise<ListBody> {
  const response = await get(s.app, `/accounts${query}`, cookies);
  expect(response.status).toBe(200);
  return response.body as ListBody;
}

describe('POST /accounts', () => {
  it('creates an account and lists it with its opening balance (AC-01)', async () => {
    const s = await setup();
    const response = await send(s.app, 'post', '/accounts', s.ana, {
      ...valid,
      openingBalance: '150000',
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      name: 'Caja',
      type: 'cash',
      currency: 'ARS',
      openingBalance: '150000',
      balance: '150000',
      archived: false,
      archivedAt: null,
    });
    const body = await list(s);
    expect(body.items.map((a) => a.name)).toEqual(['Caja']);
    expect(body.items[0]?.openingBalance).toBe('150000');
  });

  it.each([
    ['name', { type: 'cash', currency: 'ARS' }],
    ['type', { name: 'Caja', currency: 'ARS' }],
    ['currency', { name: 'Caja', type: 'cash' }],
  ])('rejects a missing %s naming the field (AC-02)', async (field, body) => {
    const s = await setup();
    const response = await send(s.app, 'post', '/accounts', s.ana, body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((response.body as { fields: string[] }).fields).toContain(`body.${field}`);
  });

  it('rejects currency EUR (AC-04)', async () => {
    const s = await setup();
    const response = await send(s.app, 'post', '/accounts', s.ana, { ...valid, currency: 'EUR' });
    expect(response.status).toBe(400);
    expect((response.body as { fields: string[] }).fields).toContain('body.currency');
  });

  it.each(['12.5', '1e3'])('rejects the non-integer opening balance %s', async (openingBalance) => {
    const s = await setup();
    const response = await send(s.app, 'post', '/accounts', s.ana, { ...valid, openingBalance });
    expect(response.status).toBe(400);
    expect((response.body as { fields: string[] }).fields).toContain('body.openingBalance');
    expect((await list(s)).items).toEqual([]);
  });

  it('defaults an omitted opening balance to "0" (AC-16)', async () => {
    const s = await setup();
    const response = await send(s.app, 'post', '/accounts', s.ana, valid);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ openingBalance: '0', balance: '0' });
  });

  it('accepts a negative opening balance and lists it (AC-17)', async () => {
    const s = await setup();
    await create(s, { openingBalance: '-150000' });
    const body = await list(s);
    expect(body.items[0]).toMatchObject({ openingBalance: '-150000', balance: '-150000' });
    expect(body.netWorthTotals.ARS).toBe('-150000');
  });

  it.each(['1000000000000001', '-1000000000000001'])(
    'rejects the opening balance %s beyond 10^15 naming body.openingBalance and creates nothing (AC-18)',
    async (openingBalance) => {
      const s = await setup();
      const response = await send(s.app, 'post', '/accounts', s.ana, { ...valid, openingBalance });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((response.body as { fields: string[] }).fields).toContain('body.openingBalance');
      expect((await list(s)).items).toEqual([]);
      const rows = await connection.pool.query('select 1 from accounts where owner_id = $1', [
        s.anaId,
      ]);
      expect(rows.rowCount).toBe(0);
    },
  );

  it.each(['1000000000000000', '-1000000000000000'])(
    'accepts exactly the opening balance %s (AC-19)',
    async (openingBalance) => {
      const s = await setup();
      const response = await send(s.app, 'post', '/accounts', s.ana, { ...valid, openingBalance });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ openingBalance, balance: openingBalance });
    },
  );

  it.each([
    ['a zero-width space', 'Ca\u200Bja'],
    ['a right-to-left override', 'Caja\u202E'],
    ['a NUL character', 'Ca\u0000ja'],
  ])('rejects a name with %s naming body.name and creates nothing (AC-20)', async (_l, name) => {
    const s = await setup();
    const response = await send(s.app, 'post', '/accounts', s.ana, { ...valid, name });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((response.body as { fields: string[] }).fields).toContain('body.name');
    expect((await list(s)).items).toEqual([]);
  });

  it.each([
    ['only spaces', '   '],
    ['only zero-width characters', '\u200B\u200B\u2060\uFEFF'],
  ])('rejects a name made of %s (AC-21)', async (_l, name) => {
    const s = await setup();
    const response = await send(s.app, 'post', '/accounts', s.ana, { ...valid, name });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((response.body as { fields: string[] }).fields).toContain('body.name');
    expect((await list(s)).items).toEqual([]);
  });

  it('rejects a duplicate name that differs only in case (AC-13)', async () => {
    const s = await setup();
    await create(s, { name: 'Caja' });
    const response = await send(s.app, 'post', '/accounts', s.ana, { ...valid, name: 'CAJA' });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_NAME_TAKEN' });
  });
});

describe('PATCH /accounts/:id', () => {
  it.each([
    ['empty', ''],
    ['51 code points', '\u{1F4B0}'.repeat(51)],
  ])('rejects a %s name naming body.name', async (_label, name) => {
    const s = await setup();
    const id = await create(s);
    const response = await send(s.app, 'patch', `/accounts/${id}`, s.ana, { name });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((response.body as { fields: string[] }).fields).toContain('body.name');
  });

  it.each([
    ['a zero-width space', 'Ca\u200Bja'],
    ['a right-to-left override', 'Caja\u202E'],
    ['a NUL character', 'Ca\u0000ja'],
    ['only spaces', '   '],
    ['only zero-width characters', '\u200B\u200B\u2060\uFEFF'],
  ])(
    'rejects a name with %s naming body.name and leaves the account unchanged (AC-20, AC-21)',
    async (_l, name) => {
      const s = await setup();
      const id = await create(s);
      const response = await send(s.app, 'patch', `/accounts/${id}`, s.ana, { name });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((response.body as { fields: string[] }).fields).toContain('body.name');
      expect((await get(s.app, `/accounts/${id}`, s.ana)).body).toMatchObject({ name: 'Caja' });
    },
  );

  it.each([{ currency: 'USD' }, { type: 'savings' }])(
    'rejects %o and leaves the account unchanged (AC-05)',
    async (extra) => {
      const s = await setup();
      const id = await create(s);
      const response = await send(s.app, 'patch', `/accounts/${id}`, s.ana, {
        name: 'Otra',
        ...extra,
      });
      expect(response.status).toBe(400);
      const field = Object.keys(extra)[0];
      expect((response.body as { fields: string[] }).fields).toContain(`body.${field}`);
      const after = await get(s.app, `/accounts/${id}`, s.ana);
      expect(after.body).toMatchObject({ name: 'Caja', type: 'cash', currency: 'ARS' });
    },
  );

  it('rejects includeInAvailable in the rename body naming the field and leaves the account unchanged (FR-04)', async () => {
    const s = await setup();
    const id = await create(s);
    const response = await send(s.app, 'patch', `/accounts/${id}`, s.ana, {
      name: 'Otra',
      includeInAvailable: false,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((response.body as { fields: string[] }).fields).toContain('body.includeInAvailable');
    expect((await rawRow(id))?.name).toBe('Caja');
    expect((await rawRow(id))?.include_in_available).toBe(true);
  });

  it('renames, visible in GET and in the list (AC-06)', async () => {
    const s = await setup();
    const id = await create(s);
    const response = await send(s.app, 'patch', `/accounts/${id}`, s.ana, { name: 'Billetera' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id, name: 'Billetera' });
    expect((await get(s.app, `/accounts/${id}`, s.ana)).body).toMatchObject({ name: 'Billetera' });
    expect((await list(s)).items.map((a) => a.name)).toEqual(['Billetera']);
  });

  it('rejects a case-insensitive duplicate name (AC-13)', async () => {
    const s = await setup();
    await create(s, { name: 'Caja' });
    const id = await create(s, { name: 'Banco' });
    const response = await send(s.app, 'patch', `/accounts/${id}`, s.ana, { name: 'cAjA' });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_NAME_TAKEN' });
  });
});

describe('archive and unarchive', () => {
  it('archive hides from the default list, keeps GET, lists under archived=true (AC-07)', async () => {
    const s = await setup();
    const id = await create(s);
    const archived = await send(s.app, 'post', `/accounts/${id}/archive`, s.ana);
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ id, archived: true });
    expect((archived.body as { archivedAt: string }).archivedAt).toEqual(expect.any(String));

    expect((await list(s)).items).toEqual([]);
    expect((await get(s.app, `/accounts/${id}`, s.ana)).status).toBe(200);
    const archivedList = await list(s, '?archived=true');
    expect(archivedList.items.map((a) => a.id)).toEqual([id]);
    expect(archivedList.total).toBe(1);

    const again = await send(s.app, 'post', `/accounts/${id}/archive`, s.ana);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(archived.body);
  });

  it('unarchive restores the account, idempotently (AC-08)', async () => {
    const s = await setup();
    const id = await create(s);
    await send(s.app, 'post', `/accounts/${id}/archive`, s.ana);
    const restored = await send(s.app, 'post', `/accounts/${id}/unarchive`, s.ana);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ id, archived: false, archivedAt: null });
    expect((await list(s)).items.map((a) => a.id)).toEqual([id]);
    expect((await send(s.app, 'post', `/accounts/${id}/unarchive`, s.ana)).status).toBe(200);
  });
});

describe('DELETE /accounts/:id', () => {
  it('answers 204 for an account without movements (AC-09)', async () => {
    const s = await setup();
    const id = await create(s);
    const response = await send(s.app, 'delete', `/accounts/${id}`, s.ana);
    expect(response.status).toBe(204);
    expect((await get(s.app, `/accounts/${id}`, s.ana)).status).toBe(404);
  });

  it('answers 409 ACCOUNT_HAS_MOVEMENTS when movements exist and keeps the account (AC-10)', async () => {
    const movements = new TestMovements();
    const s = await setup(movements);
    const id = await create(s);
    movements.withMovements.add(id);
    const response = await send(s.app, 'delete', `/accounts/${id}`, s.ana);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_HAS_MOVEMENTS' });
    expect((await get(s.app, `/accounts/${id}`, s.ana)).status).toBe(200);
  });

  it('answers 409 ACCOUNT_LINKED_TO_CARD for a linked account and keeps it (sad path, FR-02)', async () => {
    const s = await setup(undefined, { isLinked: () => Promise.resolve(true) });
    const id = await create(s);
    const response = await send(s.app, 'delete', `/accounts/${id}`, s.ana);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_LINKED_TO_CARD' });
    expect((await get(s.app, `/accounts/${id}`, s.ana)).status).toBe(200);
  });

  it('maps the card key violation to ACCOUNT_LINKED_TO_CARD when the guard is bypassed (sad path)', async () => {
    const s = await setup();
    const ars = await create(s);
    const usd = await create(s, { name: 'Linked USD', currency: 'USD' });
    await connection.pool.query(
      'insert into credit_cards (owner_id, name, closing_day, due_day, ars_account_id, usd_account_id) values ($1, $2, 24, 5, $3, $4)',
      [s.anaId, 'Linked', ars, usd],
    );
    const response = await send(s.app, 'delete', `/accounts/${ars}`, s.ana);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ code: 'ACCOUNT_LINKED_TO_CARD' });
  });

  it("answers 404, never 409, for another user's account that has movements", async () => {
    const movements = new TestMovements();
    const s = await setup(movements);
    const id = await create(s);
    movements.withMovements.add(id);
    const response = await send(s.app, 'delete', `/accounts/${id}`, s.bob);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'NOT_FOUND' });
    expect((await get(s.app, `/accounts/${id}`, s.ana)).status).toBe(200);
  });
});

const INT64_MAX = 9_223_372_036_854_775_807n;

describe('GET /accounts balances, totals and paging', () => {
  it('balance equals the opening balance with the default adapter (AC-11)', async () => {
    const plain = await setup();
    await create(plain, { openingBalance: '1000' });
    expect((await list(plain)).items[0]?.balance).toBe('1000');
  });

  it('adds the movements sum to the opening balance (AC-11)', async () => {
    const movements = new TestMovements();
    const s = await setup(movements);
    const id = await create(s, { openingBalance: '1000' });
    movements.sums.set(id, -250n);
    expect((await list(s)).items[0]).toMatchObject({ openingBalance: '1000', balance: '750' });
    expect((await get(s.app, `/accounts/${id}`, s.ana)).body).toMatchObject({ balance: '750' });
  });

  it('totals per currency cover every active account across pages (AC-12)', async () => {
    const movements = new TestMovements();
    const s = await setup(movements);
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(await create(s, { name: `ars ${i}`, openingBalance: String(1000 * (i + 1)) }));
    }
    await create(s, { name: 'usd', currency: 'USD', openingBalance: '77' });
    const archivedId = await create(s, { name: 'old', openingBalance: '999999' });
    await send(s.app, 'post', `/accounts/${archivedId}/archive`, s.ana);
    const firstId = ids[0];
    if (firstId === undefined) throw new Error('no accounts created');
    movements.sums.set(firstId, 5n);

    const first = await list(s, '?limit=2&offset=0');
    const second = await list(s, '?limit=2&offset=2');
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    expect(first.total).toBe(6);
    expect(first).toMatchObject({ limit: 2, offset: 0 });
    expect(second.netWorthTotals).toEqual({ ARS: '15005', USD: '77' });
    expect(first.netWorthTotals).toEqual(second.netWorthTotals);
    expect((await list(s, '?archived=true')).total).toBe(1);
  });

  it('answers 200 with exact available, net worth and debt totals for 9,300 accounts at 10^15 (AC-17, NFR-01)', async () => {
    const s = await setup();
    // 9,300 ARS accounts at the opening balance bound: 4,000 included cash, 3,000 savings left
    // out of Available, 2,300 credit cards. Only net worth passes the signed 64-bit maximum here;
    // the two cases below push Available and Debt past it.
    await connection.pool.query(
      `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
       select $1, 'Big ' || n,
              case when n <= 4000 then 'cash' when n <= 7000 then 'savings' else 'credit_card' end,
              'ARS', 1000000000000000, n <= 4000
         from generate_series(1, $2::int) as n`,
      [s.anaId, 9300],
    );
    const response = await get(s.app, '/accounts?limit=2', s.ana);
    expect(response.status).toBe(200);
    const body = response.body as ListBody;
    expect(body.availableTotals).toEqual({ ARS: '4000000000000000000', USD: '0' });
    expect(body.netWorthTotals).toEqual({ ARS: '9300000000000000000', USD: '0' });
    expect(body.debtTotals).toEqual({ ARS: '2300000000000000000', USD: '0' });
    expect(BigInt(body.netWorthTotals.ARS)).toBeGreaterThan(INT64_MAX);
    expect(body.creditCardCount).toBe(2300);
    expect(body.total).toBe(9300);
  }, 60_000);

  it('lists an Available and Net worth above the int64 maximum for 9,300 included cash accounts at 10^15 (AC-17, NFR-01)', async () => {
    const s = await setup();
    await connection.pool.query(
      `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
       select $1, 'Cash ' || n, 'cash', 'ARS', 1000000000000000, true
         from generate_series(1, $2::int) as n`,
      [s.anaId, 9300],
    );
    const response = await get(s.app, '/accounts?limit=2', s.ana);
    expect(response.status).toBe(200);
    const body = response.body as ListBody;
    expect(body.availableTotals).toEqual({ ARS: '9300000000000000000', USD: '0' });
    expect(body.netWorthTotals).toEqual({ ARS: '9300000000000000000', USD: '0' });
    expect(body.debtTotals).toEqual({ ARS: '0', USD: '0' });
    expect(BigInt(body.availableTotals.ARS)).toBeGreaterThan(INT64_MAX);
    expect(BigInt(body.netWorthTotals.ARS)).toBeGreaterThan(INT64_MAX);
  }, 60_000);

  it('lists a Debt and Net worth above the int64 maximum for 9,300 credit cards at 10^15 (AC-17, NFR-01)', async () => {
    const s = await setup();
    await connection.pool.query(
      `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
       select $1, 'Card ' || n, 'credit_card', 'ARS', 1000000000000000, false
         from generate_series(1, $2::int) as n`,
      [s.anaId, 9300],
    );
    const response = await get(s.app, '/accounts?limit=2', s.ana);
    expect(response.status).toBe(200);
    const body = response.body as ListBody;
    expect(body.availableTotals).toEqual({ ARS: '0', USD: '0' });
    expect(body.netWorthTotals).toEqual({ ARS: '9300000000000000000', USD: '0' });
    expect(body.debtTotals).toEqual({ ARS: '9300000000000000000', USD: '0' });
    expect(body.creditCardCount).toBe(9300);
    expect(BigInt(body.debtTotals.ARS)).toBeGreaterThan(INT64_MAX);
    expect(BigInt(body.netWorthTotals.ARS)).toBeGreaterThan(INT64_MAX);
  }, 60_000);

  it('accepts limit 100 and rejects 101 (NFR-03)', async () => {
    const s = await setup();
    expect((await get(s.app, '/accounts?limit=100', s.ana)).status).toBe(200);
    const response = await get(s.app, '/accounts?limit=101', s.ana);
    expect(response.status).toBe(400);
    expect((response.body as { fields: string[] }).fields).toContain('query.limit');
  });
});

const PUT_PATH = (id: string) => `/accounts/${id}/include-in-available`;

async function rawRow(id: string) {
  const rows = await connection.pool.query<{
    include_in_available: boolean;
    name: string;
    updated_at: Date;
  }>('select include_in_available, name, updated_at from accounts where id = $1', [id]);
  return rows.rows[0];
}

describe('includeInAvailable on create and list', () => {
  it('POST returns includeInAvailable and the list returns it for each account (AC-01, AC-02)', async () => {
    const s = await setup();
    const response = await send(s.app, 'post', '/accounts', s.ana, valid);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ includeInAvailable: true });
    await create(s, { name: 'Ahorro', type: 'savings' });
    const body = await list(s);
    expect(body.items.map((a) => [a.name, a.includeInAvailable]).sort()).toEqual([
      ['Ahorro', false],
      ['Caja', true],
    ]);
  });

  it.each(['true', 1, null, 'yes'])(
    'rejects the non-boolean includeInAvailable %o naming body.includeInAvailable and creates nothing (AC-06)',
    async (value) => {
      const s = await setup();
      const response = await send(s.app, 'post', '/accounts', s.ana, {
        ...valid,
        includeInAvailable: value,
      });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((response.body as { fields: string[] }).fields).toContain('body.includeInAvailable');
      expect(JSON.stringify(response.body)).not.toContain('yes');
      expect((await list(s)).items).toEqual([]);
    },
  );

  it.each([
    ['cash', true],
    ['bank_account', true],
    ['digital_wallet', true],
    ['savings', false],
    ['credit_card', false],
  ])('defaults %s to includeInAvailable %s (AC-03, AC-04, AC-09)', async (type, expected) => {
    const s = await setup();
    const response = await send(s.app, 'post', '/accounts', s.ana, { ...valid, type });
    expect(response.status).toBe(201);
    expect((response.body as { includeInAvailable: boolean }).includeInAvailable).toBe(expected);
    expect((await rawRow((response.body as { id: string }).id))?.include_in_available).toBe(
      expected,
    );
  });

  it.each([
    ['cash', false],
    ['savings', true],
    ['bank_account', false],
  ])('keeps an explicit %s value %s (AC-05)', async (type, value) => {
    const s = await setup();
    const response = await send(s.app, 'post', '/accounts', s.ana, {
      ...valid,
      type,
      includeInAvailable: value,
    });
    expect(response.status).toBe(201);
    expect((response.body as { includeInAvailable: boolean }).includeInAvailable).toBe(value);
    expect((await rawRow((response.body as { id: string }).id))?.include_in_available).toBe(value);
  });

  it('refuses a credit card created as included, naming the field, and creates nothing (AC-10)', async () => {
    const s = await setup();
    const response = await send(s.app, 'post', '/accounts', s.ana, {
      ...valid,
      type: 'credit_card',
      includeInAvailable: true,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((response.body as { fields: string[] }).fields).toContain('body.includeInAvailable');
    expect((await list(s)).items).toEqual([]);
  });
});

describe('PUT /accounts/:id/include-in-available', () => {
  it('persists the value, leaves other fields unchanged and is idempotent (AC-07)', async () => {
    const s = await setup();
    const id = await create(s, { openingBalance: '500' });
    const before = (await get(s.app, `/accounts/${id}`, s.ana)).body as Record<string, unknown>;
    const first = await send(s.app, 'put', PUT_PATH(id), s.ana, { includeInAvailable: false });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ...before, includeInAvailable: false });
    expect((await rawRow(id))?.include_in_available).toBe(false);
    const stamp = (await rawRow(id))?.updated_at;
    const again = await send(s.app, 'put', PUT_PATH(id), s.ana, { includeInAvailable: false });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect((await rawRow(id))?.updated_at).toEqual(stamp);
    const back = await send(s.app, 'put', PUT_PATH(id), s.ana, { includeInAvailable: true });
    expect(back.body).toEqual(before);
    expect((await get(s.app, `/accounts/${id}`, s.ana)).body).toEqual(before);
  });

  it.each([
    { includeInAvailable: 'true' },
    { includeInAvailable: 1 },
    { includeInAvailable: null },
    {},
  ])(
    'rejects the body %o naming body.includeInAvailable and leaves the account unchanged (AC-08)',
    async (body) => {
      const s = await setup();
      const id = await create(s);
      const response = await send(s.app, 'put', PUT_PATH(id), s.ana, body);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((response.body as { fields: string[] }).fields).toContain('body.includeInAvailable');
      expect((await rawRow(id))?.include_in_available).toBe(true);
    },
  );

  it.each([true, false])(
    'answers 400 naming the field for a credit card with %s and leaves it unchanged (AC-11)',
    async (value) => {
      const s = await setup();
      const id = await create(s, { type: 'credit_card' });
      const response = await send(s.app, 'put', PUT_PATH(id), s.ana, { includeInAvailable: value });
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        code: 'VALIDATION_FAILED',
        fields: ['body.includeInAvailable'],
      });
      expect((await rawRow(id))?.include_in_available).toBe(false);
    },
  );

  it('answers 409 ACCOUNT_ARCHIVED for an archived account and works after unarchive (AC-12, AC-13)', async () => {
    const s = await setup();
    const id = await create(s);
    await send(s.app, 'post', `/accounts/${id}/archive`, s.ana);
    const refused = await send(s.app, 'put', PUT_PATH(id), s.ana, { includeInAvailable: false });
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ code: 'ACCOUNT_ARCHIVED' });
    expect((await rawRow(id))?.include_in_available).toBe(true);
    await send(s.app, 'post', `/accounts/${id}/unarchive`, s.ana);
    const ok = await send(s.app, 'put', PUT_PATH(id), s.ana, { includeInAvailable: false });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ includeInAvailable: false });
  });

  it('answers another user account with the same 404 body as a missing id (AC-22)', async () => {
    const s = await setup();
    const id = await create(s);
    // The route exists for the owner, so the 404 below is about ownership and not an unmounted path.
    const own = await send(s.app, 'put', PUT_PATH(id), s.ana, { includeInAvailable: true });
    expect(own.status).toBe(200);
    const foreign = await send(s.app, 'put', PUT_PATH(id), s.bob, { includeInAvailable: false });
    const absent = await send(s.app, 'put', PUT_PATH(randomUUID()), s.bob, {
      includeInAvailable: false,
    });
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual({ code: 'NOT_FOUND' });
    expect(foreign.body).toEqual(absent.body);
    expect((await rawRow(id))?.include_in_available).toBe(true);
  });
});

describe('GET /accounts available, net worth and debt totals', () => {
  it('answers zero debt, no cards and no card item for a user without credit cards (AC-20)', async () => {
    const s = await setup();
    await create(s, { name: 'cash', openingBalance: '1000' });
    await create(s, { name: 'usd', currency: 'USD', openingBalance: '5' });
    const body = await list(s);
    expect(body.debtTotals).toEqual({ ARS: '0', USD: '0' });
    expect(body.creditCardCount).toBe(0);
    expect(body.items).toHaveLength(2);
    const empty = await list(s, '', s.bob);
    expect(empty.debtTotals).toEqual({ ARS: '0', USD: '0' });
    expect(empty.creditCardCount).toBe(0);
    expect(empty.items).toEqual([]);
  });

  it('keeps a card balance out of availableTotals and shows the card in items (AC-14)', async () => {
    const s = await setup();
    await create(s, { name: 'cash', openingBalance: '1000' });
    const card = await create(s, { name: 'card', type: 'credit_card', openingBalance: '-400' });
    const body = await list(s);
    expect(body.availableTotals).toEqual({ ARS: '1000', USD: '0' });
    expect(body.netWorthTotals).toEqual({ ARS: '600', USD: '0' });
    expect(body.debtTotals).toEqual({ ARS: '-400', USD: '0' });
    expect(body.creditCardCount).toBe(1);
    expect(body.items.map((a) => a.id)).toContain(card);
  });

  it('returns the three totals per currency over more than one page (AC-14, AC-15, AC-16, AC-19)', async () => {
    const movements = new TestMovements();
    const s = await setup(movements);
    const cash = await create(s, { name: 'cash', openingBalance: '1000' });
    await create(s, { name: 'bank', type: 'bank_account', openingBalance: '2000' });
    await create(s, { name: 'sav', type: 'savings', openingBalance: '4000' });
    await create(s, { name: 'usd', currency: 'USD', openingBalance: '70' });
    const card = await create(s, { name: 'card', type: 'credit_card', openingBalance: '-300' });
    await create(s, { name: 'card2', type: 'credit_card', openingBalance: '0' });
    const old = await create(s, { name: 'old', openingBalance: '999999' });
    await send(s.app, 'post', `/accounts/${old}/archive`, s.ana);
    movements.sums.set(cash, 50n);
    movements.sums.set(card, -20n);
    await send(s.app, 'put', PUT_PATH(cash), s.ana, { includeInAvailable: false });

    const first = await list(s, '?limit=2&offset=0');
    const last = await list(s, '?limit=2&offset=4');
    expect(first.items).toHaveLength(2);
    for (const body of [first, last]) {
      expect(body.availableTotals).toEqual({ ARS: '2000', USD: '70' });
      expect(body.netWorthTotals).toEqual({ ARS: '6730', USD: '70' });
      expect(body.debtTotals).toEqual({ ARS: '-320', USD: '0' });
      expect(body.creditCardCount).toBe(2);
    }
  });
});

describe('ownership (AC-14, AC-15)', () => {
  it('lists only the caller accounts (AC-15)', async () => {
    const s = await setup();
    await create(s, { name: 'Ana' });
    await create(s, { name: 'Bob' }, s.bob);
    expect((await list(s)).items.map((a) => a.name)).toEqual(['Ana']);
    expect((await list(s, '', s.bob)).items.map((a) => a.name)).toEqual(['Bob']);
  });

  it('answers another user account exactly like a missing id, and changes nothing (AC-14)', async () => {
    const movements = new TestMovements();
    const s = await setup(movements);
    const id = await create(s);
    const missing = randomUUID();
    const as = (target: string) => ({
      get: () => get(s.app, `/accounts/${target}`, s.bob),
      patch: () => send(s.app, 'patch', `/accounts/${target}`, s.bob, { name: 'hacked' }),
      archive: () => send(s.app, 'post', `/accounts/${target}/archive`, s.bob),
      unarchive: () => send(s.app, 'post', `/accounts/${target}/unarchive`, s.bob),
      include: () =>
        send(s.app, 'put', `/accounts/${target}/include-in-available`, s.bob, {
          includeInAvailable: false,
        }),
      remove: () => send(s.app, 'delete', `/accounts/${target}`, s.bob),
    });
    for (const name of ['get', 'patch', 'archive', 'unarchive', 'include', 'remove'] as const) {
      const foreign = await as(id)[name]();
      const absent = await as(missing)[name]();
      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(absent.body);
      expect(foreign.body).toEqual({ code: 'NOT_FOUND' });
    }
    expect((await get(s.app, `/accounts/${id}`, s.ana)).body).toMatchObject({
      name: 'Caja',
      archived: false,
    });
  });
});

describe('input validation on ids and query', () => {
  it.each([
    ['get', 'get', (id: string) => `/accounts/${id}`],
    ['patch', 'patch', (id: string) => `/accounts/${id}`],
    ['archive', 'post', (id: string) => `/accounts/${id}/archive`],
    ['unarchive', 'post', (id: string) => `/accounts/${id}/unarchive`],
    ['include', 'put', (id: string) => `/accounts/${id}/include-in-available`],
    ['delete', 'delete', (id: string) => `/accounts/${id}`],
  ] as const)('%s rejects a non-UUID id with 400 VALIDATION_FAILED', async (_n, method, path) => {
    const s = await setup();
    const url = path('not-a-uuid');
    const response =
      method === 'get'
        ? await get(s.app, url, s.ana)
        : await send(
            s.app,
            method,
            url,
            s.ana,
            method === 'patch'
              ? { name: 'x' }
              : method === 'put'
                ? { includeInAvailable: true }
                : undefined,
          );
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it.each(['?archived=maybe', '?offset=-1', '?limit='])(
    'list rejects %s with 400',
    async (query) => {
      const s = await setup();
      const response = await get(s.app, `/accounts${query}`, s.ana);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    },
  );
});

describe('authentication and request guards', () => {
  const routes: [string, 'get' | 'post' | 'patch' | 'delete' | 'put', (id: string) => string][] = [
    ['list', 'get', () => '/accounts'],
    ['create', 'post', () => '/accounts'],
    ['get', 'get', (id) => `/accounts/${id}`],
    ['patch', 'patch', (id) => `/accounts/${id}`],
    ['archive', 'post', (id) => `/accounts/${id}/archive`],
    ['unarchive', 'post', (id) => `/accounts/${id}/unarchive`],
    ['include', 'put', (id) => `/accounts/${id}/include-in-available`],
    ['delete', 'delete', (id) => `/accounts/${id}`],
  ];

  function call(
    app: Express,
    method: 'get' | 'post' | 'patch' | 'delete' | 'put',
    path: string,
    cookies?: SessionCookies,
  ) {
    const req = request(app)[method](path).set(trustedHeaders);
    if (cookies) req.set('Cookie', cookieHeader(cookies));
    if (method === 'put') return req.send({ includeInAvailable: true });
    return req.send(method === 'get' || method === 'delete' ? undefined : { ...valid });
  }

  it.each(routes)('%s answers 401 without a session', async (_name, method, path) => {
    const s = await setup();
    const response = await call(s.app, method, path(randomUUID()));
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
  });

  it.each(routes)(
    '%s answers 403 EMAIL_NOT_VERIFIED for an unverified user',
    async (_n, method, path) => {
      const s = await setup();
      await seedUser(connection, { email: 'eve@example.com', password: PASSWORD, verified: false });
      const eve = sessionFrom(await signIn(s.app, 'eve@example.com', PASSWORD));
      const response = await call(s.app, method, path(randomUUID()), eve);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
    },
  );

  it('refuses a state-changing request without the web origin headers (error path)', async () => {
    const s = await setup();
    const noOrigin = await request(s.app)
      .post('/accounts')
      .set('Cookie', cookieHeader(s.ana))
      .send(valid);
    expect(noOrigin.status).toBe(403);
    const noHeader = await request(s.app)
      .post('/accounts')
      .set('Origin', trustedHeaders.Origin)
      .set('Cookie', cookieHeader(s.ana))
      .send(valid);
    expect(noHeader.status).toBe(403);
    expect((await list(s)).items).toEqual([]);
  });

  it('refuses PUT include-in-available without the web origin headers and changes nothing (error path)', async () => {
    const s = await setup();
    const id = await create(s);
    const body = { includeInAvailable: false };
    const noOrigin = await request(s.app)
      .put(PUT_PATH(id))
      .set('Cookie', cookieHeader(s.ana))
      .send(body);
    expect(noOrigin.status).toBe(403);
    const noHeader = await request(s.app)
      .put(PUT_PATH(id))
      .set('Origin', trustedHeaders.Origin)
      .set('Cookie', cookieHeader(s.ana))
      .send(body);
    expect(noHeader.status).toBe(403);
    expect((await rawRow(id))?.include_in_available).toBe(true);
    // Control: the same request with the headers goes through, so the 403 above is the guard.
    const ok = await send(s.app, 'put', PUT_PATH(id), s.ana, body);
    expect(ok.status).toBe(200);
  });
});

describe('audit log (NFR-04)', () => {
  it('records user id and account id for create, archive, unarchive, setting change and delete, never name or amount', async () => {
    const s = await setup();
    const name = 'Secret Savings Name';
    const id = await create(s, { name, openingBalance: '123456789' });
    await send(s.app, 'post', `/accounts/${id}/archive`, s.ana);
    await send(s.app, 'post', `/accounts/${id}/unarchive`, s.ana);
    await send(s.app, 'put', `/accounts/${id}/include-in-available`, s.ana, {
      includeInAvailable: false,
    });
    await send(s.app, 'delete', `/accounts/${id}`, s.ana);

    const audit = s.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => typeof entry.msg === 'string' && entry.msg.startsWith('account '));
    expect(audit.map((entry) => entry.msg)).toEqual([
      'account created',
      'account archived',
      'account unarchived',
      'account include-in-available changed',
      'account deleted',
    ]);
    // Per-message allowlist: pino base keys plus the audit fields; only the setting-change line may
    // carry the boolean, and a new field must be added here on purpose.
    const base = ['level', 'time', 'pid', 'hostname', 'msg', 'requestId', 'userId', 'accountId'];
    const allowedFor = (msg: unknown) =>
      new Set(
        msg === 'account include-in-available changed' ? [...base, 'includeInAvailable'] : base,
      );
    for (const entry of audit) {
      expect(entry).toMatchObject({ userId: s.anaId, accountId: id });
      if (entry.msg === 'account include-in-available changed') {
        expect(entry.includeInAvailable).toBe(false);
      }
      expect(Object.keys(entry).filter((key) => !allowedFor(entry.msg).has(key))).toEqual([]);
      expect(entry.requestId).toEqual(expect.any(String));
      const text = JSON.stringify(entry);
      expect(text).not.toContain(name);
      expect(text).not.toContain('123456789');
    }
  });
});
