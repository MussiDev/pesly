import { randomUUID } from 'node:crypto';
import {
  listMovementsResponseSchema,
  movementDetailResponseSchema,
  movementResponseSchema,
  type MovementResponse,
} from '@pesly/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAccountRoutes } from '../../src/accounts';
import { createAccountMovements, createMovementRoutes } from '../../src/movements';
import { MovementLockedByGroupExpense } from '../../src/movements/domain/errors';
import type { NewMovement } from '../../src/movements/application/ports/movement-repository';
import { DrizzleMovementRepository } from '../../src/movements/infrastructure/db/drizzle-movement-repository';
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
import { newAccount, newCategory, writeScope } from './db-fixtures';

/** The edit lock of an adopted movement and the group link read (spec DISC-001-05i, Block 5). */

let connection: DatabaseConnection;
let repository: DrizzleMovementRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleMovementRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const PASSWORD = 'a long enough passphrase';
const WHEN = new Date('2026-10-02T15:30:00.000Z');

interface World {
  app: Express;
  ana: SessionCookies;
  bob: SessionCookies;
  anaId: string;
  bobId: string;
  ars1: string;
  ars2: string;
  category: string;
  group: string;
  member: string;
  groupCategory: string;
}

async function one(sql: string, params: unknown[] = []): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(sql, params);
  const row = result.rows[0];
  if (!row) throw new Error('no row');
  return row.id;
}

async function world(): Promise<World> {
  const logger = createLogger({ level: 'debug', destination: { write: () => undefined } });
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
  const { pool } = connection;
  const group = await one(
    "insert into groups (name, default_rate_type) values ('Trip', 'blue') returning id",
  );
  const member = await one(
    'insert into group_members (group_id, user_id) values ($1, $2) returning id',
    [group, anaId],
  );
  const groupCategory = await one(
    `insert into group_categories (group_id, name, icon, color)
     values ($1, 'Food', 'wallet', 'blue') returning id`,
    [group],
  );
  return {
    app: harness.app,
    ana,
    bob,
    anaId,
    bobId,
    ars1: await newAccount(pool, anaId),
    ars2: await newAccount(pool, anaId),
    category: await newCategory(pool, anaId, 'expense'),
    group,
    member,
    groupCategory,
  };
}

function body(w: World, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'expense',
    accountId: w.ars1,
    categoryId: w.category,
    amount: '150000',
    occurredAt: WHEN.toISOString(),
    note: 'dinner',
    tags: ['a'],
    rate: { source: 'manual', value: '14000000' },
    ...overrides,
  };
}

async function create(
  w: World,
  overrides: Record<string, unknown> = {},
): Promise<MovementResponse> {
  const response = await request(w.app)
    .post('/movements')
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(w.ana))
    .send(body(w, overrides));
  expect(response.status).toBe(201);
  return movementResponseSchema.parse(response.body);
}

function put(w: World, id: string, payload: Record<string, unknown>) {
  return request(w.app)
    .put(`/movements/${id}`)
    .set(trustedHeaders)
    .set('Cookie', cookieHeader(w.ana))
    .send(payload);
}

function getAs(w: World, path: string, who: SessionCookies) {
  return request(w.app).get(path).set('Cookie', cookieHeader(who));
}

/** A group expense linked to the movement, as a send (adopted) or a group creation (not). */
async function link(w: World, movementId: string, adopted: boolean): Promise<string> {
  return one(
    `insert into group_expenses (group_id, payer_member_id, created_by_member_id, amount, currency,
       occurred_at, category_id, description, split_mode, payer_movement_id, adopted_movement)
     values ($1, $2, $2, 150000, 'ARS', $3, $4, 'Dinner', 'equal', $5, $6) returning id`,
    [w.group, w.member, WHEN, w.groupCategory, movementId, adopted],
  );
}

async function row(id: string): Promise<{ amount: string; account_id: string; note: string }> {
  const result = await connection.pool.query<{ amount: string; account_id: string; note: string }>(
    'select amount::text as amount, account_id, note from movements where id = $1',
    [id],
  );
  const found = result.rows[0];
  if (!found) throw new Error('no movement');
  return found;
}

describe('PUT /movements/:id on an adopted movement', () => {
  it('answers 409 MOVEMENT_LOCKED_BY_GROUP_EXPENSE for a changed amount, account or date and changes nothing (AC-25)', async () => {
    const w = await world();
    const created = await create(w);
    await link(w, created.id, true);

    for (const change of [
      { amount: '150001' },
      { accountId: w.ars2 },
      { occurredAt: new Date(WHEN.getTime() + 1).toISOString() },
    ]) {
      const response = await put(w, created.id, body(w, change));
      expect(response.status).toBe(409);
      expect(response.body).toEqual({ code: 'MOVEMENT_LOCKED_BY_GROUP_EXPENSE' });
    }
    expect(await row(created.id)).toMatchObject({ amount: '150000', account_id: w.ars1 });
  });

  it('saves a change of the note, the tags and the category (AC-26)', async () => {
    const w = await world();
    const created = await create(w);
    await link(w, created.id, true);
    const other = await newCategory(connection.pool, w.anaId, 'expense');

    const response = await put(
      w,
      created.id,
      body(w, { note: 'edited', tags: ['x'], categoryId: other }),
    );

    expect(response.status).toBe(200);
    expect(movementResponseSchema.parse(response.body)).toMatchObject({
      note: 'edited',
      tags: ['x'],
      categoryId: other,
    });
  });

  it('does not lock a movement linked to a non-adopted expense (FR-10)', async () => {
    const w = await world();
    const created = await create(w);
    await link(w, created.id, false);

    const response = await put(w, created.id, body(w, { amount: '99' }));

    expect(response.status).toBe(200);
    expect((await row(created.id)).amount).toBe('99');
  });

  it('keeps an adopted movement as it is when a device creation id is replayed with other values (AC-25)', async () => {
    const w = await world();
    const id = randomUUID();
    const first = await request(w.app)
      .post('/movements')
      .set(trustedHeaders)
      .set('Cookie', cookieHeader(w.ana))
      .send(body(w, { id }));
    expect(first.status).toBe(201);
    await link(w, id, true);

    const replay = await request(w.app)
      .post('/movements')
      .set(trustedHeaders)
      .set('Cookie', cookieHeader(w.ana))
      .send(body(w, { id, amount: '1' }));

    expect(replay.status).toBe(200);
    expect(movementResponseSchema.parse(replay.body).amount).toBe('150000');
    expect((await row(id)).amount).toBe('150000');
  });
});

describe('DrizzleMovementRepository.update and the group lock', () => {
  function data(w: World, overrides: Record<string, unknown> = {}): NewMovement {
    return {
      type: 'expense',
      accountId: w.ars1,
      categoryId: w.category,
      amount: 150_000n,
      occurredAt: WHEN,
      note: 'dinner',
      rate: 14_000_000n,
      rateSource: 'manual',
      rateType: null,
      tags: [],
      ...overrides,
    };
  }

  it('throws MovementLockedByGroupExpense by default and lets bypassGroupLock change amount and date (AC-28)', async () => {
    const w = await world();
    const created = await create(w);
    await link(w, created.id, true);
    const scope = await writeScope(w.anaId);
    const later = new Date(WHEN.getTime() + 60_000);

    await expect(
      repository.update(scope, created.id, data(w, { amount: 5n })),
    ).rejects.toBeInstanceOf(MovementLockedByGroupExpense);

    const moved = await repository.update(
      scope,
      created.id,
      data(w, { amount: 5n, occurredAt: later }),
      {
        bypassGroupLock: true,
      },
    );
    expect(moved).toMatchObject({ amount: 5n, occurredAt: later });
  });

  it('serialises with a concurrent adoption: the edit waits for the lock and is then refused (AC-24, AC-25)', async () => {
    const w = await world();
    const created = await create(w);
    const scope = await writeScope(w.anaId);
    const client = await connection.pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from movements where id = $1 for update', [created.id]);
      const edit = repository.update(scope, created.id, data(w, { amount: 7n }));
      const outcome = edit.then(
        () => 'saved',
        (error: unknown) => error,
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      await client.query(
        `insert into group_expenses (group_id, payer_member_id, created_by_member_id, amount,
           currency, occurred_at, category_id, description, split_mode, payer_movement_id,
           adopted_movement)
         values ($1, $2, $2, 150000, 'ARS', $3, $4, 'Dinner', 'equal', $5, true)`,
        [w.group, w.member, WHEN, w.groupCategory, created.id],
      );
      await client.query('commit');

      expect(await outcome).toBeInstanceOf(MovementLockedByGroupExpense);
      expect((await row(created.id)).amount).toBe('150000');
    } finally {
      client.release();
    }
  });
});

describe('GET /movements/:id', () => {
  it('answers groupExpense null for a free movement, the link for a linked one, and 404 for another user (AC-05, AC-32)', async () => {
    const w = await world();
    const free = await create(w);
    const linked = await create(w);
    const expenseId = await link(w, linked.id, true);

    const freeResponse = await getAs(w, `/movements/${free.id}`, w.ana);
    const linkedResponse = await getAs(w, `/movements/${linked.id}`, w.ana);
    const foreign = await getAs(w, `/movements/${linked.id}`, w.bob);

    expect(movementDetailResponseSchema.parse(freeResponse.body).groupExpense).toBeNull();
    expect(movementDetailResponseSchema.parse(linkedResponse.body).groupExpense).toEqual({
      groupId: w.group,
      expenseId,
      adopted: true,
    });
    expect(foreign.status).toBe(404);
  });
});

describe('GET /movements groupLinks', () => {
  it('has an entry only for the linked movements of the page, adopted or not, and {} when none (AC-05)', async () => {
    const w = await world();
    const free = await create(w);
    expect(
      listMovementsResponseSchema.parse((await getAs(w, '/movements', w.ana)).body).groupLinks,
    ).toEqual({});

    const adopted = await create(w);
    const grouped = await create(w);
    const adoptedExpense = await link(w, adopted.id, true);
    const groupedExpense = await link(w, grouped.id, false);

    const parsed = listMovementsResponseSchema.parse((await getAs(w, '/movements', w.ana)).body);
    expect(parsed.groupLinks).toEqual({
      [adopted.id]: { groupId: w.group, expenseId: adoptedExpense, adopted: true },
      [grouped.id]: { groupId: w.group, expenseId: groupedExpense, adopted: false },
    });
    expect(parsed.groupLinks[free.id]).toBeUndefined();
  });

  it('shows no link of another user and costs one extra query (AC-05, NFR-09)', async () => {
    const w = await world();
    const mine = await create(w);
    await link(w, mine.id, true);

    const bobScope = await writeScope(w.bobId);
    expect(await repository.groupLinks(bobScope, [mine.id])).toEqual({});

    const spy = vi.spyOn(connection.pool, 'query');
    const scope = await writeScope(w.anaId);
    await repository.list(scope, { limit: 10, offset: 0, filters: {} });
    const withoutLinks = spy.mock.calls.length;
    spy.mockClear();
    await repository.list(scope, { limit: 10, offset: 0, filters: {} });
    await repository.groupLinks(scope, [mine.id]);
    const withLinks = spy.mock.calls.length;
    spy.mockRestore();

    expect(withLinks - withoutLinks).toBe(1);
    expect(await repository.groupLinks(scope, [])).toEqual({});
  });
});
