import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RATE_MAX_SCALED, type CategoryKind } from '@pesly/shared';
import { Email } from '../../src/identity/domain/email';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import {
  DrizzleMovementRepository,
  listMovementsQuery,
  loadTagsOf,
} from '../../src/movements/infrastructure/db/drizzle-movement-repository';
import type { NewMovement } from '../../src/movements/application/ports/movement-repository';
import { OwnerOrGroupMemberAccessPolicy, type AccessScope } from '../../src/shared/access';
import { ResourceNotFound } from '../../src/shared/access/not-found-unless-allowed';
import { DenyAllGroupMembershipReader } from '../../src/shared/access/infrastructure/deny-all-group-membership-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { violatedConstraint } from '../../src/shared/db/pg-errors';
import { testDatabaseUrl } from '../helpers/test-database';
import { newTag } from './db-fixtures';

let connection: DatabaseConnection;
let repository: DrizzleMovementRepository;
let users: DrizzleUserRepository;

const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleMovementRepository(connection.db);
  users = new DrizzleUserRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

function writeScope(userId: string): Promise<AccessScope<'write'>> {
  return policy.scopeFor({ userId, sessionId: 's', emailVerified: true }, 'write');
}

function readScope(userId: string): Promise<AccessScope<'read'>> {
  return policy.scopeFor({ userId, sessionId: 's', emailVerified: true }, 'read');
}

async function newUserId(email: string): Promise<string> {
  const user = await users.create({
    email: Email.parse(email),
    passwordHash: 'h',
    defaultRateType: 'mep',
    displayCurrency: 'ARS',
    timeZone: 'America/Cordoba',
    language: 'es',
  });
  return user.id;
}

function firstId(rows: { id: string }[]): string {
  const row = rows[0];
  if (!row) throw new Error('The insert returned no row');
  return row.id;
}

async function newAccount(ownerId: string, name = 'Caja'): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available)
     values ($1, $2, 'cash', 'ARS', 0, true) returning id`,
    [ownerId, name],
  );
  return firstId(result.rows);
}

async function newCategory(ownerId: string, kind: CategoryKind, name = 'Comida'): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    `insert into categories (owner_id, kind, name, icon, color)
     values ($1, $2, $3, 'tag', 'blue') returning id`,
    [ownerId, kind, name],
  );
  return firstId(result.rows);
}

interface Fixture {
  ownerId: string;
  accountId: string;
  expenseCategoryId: string;
  incomeCategoryId: string;
}

async function fixture(email = 'ana@example.com'): Promise<Fixture> {
  const ownerId = await newUserId(email);
  return {
    ownerId,
    accountId: await newAccount(ownerId),
    expenseCategoryId: await newCategory(ownerId, 'expense'),
    incomeCategoryId: await newCategory(ownerId, 'income', 'Sueldo'),
  };
}

function data(f: Fixture, overrides: Record<string, unknown> = {}): NewMovement {
  return {
    type: 'expense',
    accountId: f.accountId,
    categoryId: f.expenseCategoryId,
    amount: 12_345n,
    occurredAt: new Date('2026-10-02T15:30:00.000Z'),
    note: null,
    rate: 16_233_000n,
    rateSource: 'manual',
    rateType: null,
    tags: [],
    ...overrides,
  };
}

async function sqlState(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    let current: unknown = error;
    while (current instanceof Error) {
      const code: unknown = Reflect.get(current, 'code');
      if (typeof code === 'string') return code;
      current = current.cause;
    }
    return undefined;
  }
}

/** Inserts a raw row, bypassing the repository, to reach the database constraints. */
async function rawInsert(
  f: Fixture,
  overrides: Record<string, unknown> = {},
): Promise<{ rowCount: number | null }> {
  const row: Record<string, unknown> = {
    owner_id: f.ownerId,
    type: 'expense',
    account_id: f.accountId,
    category_id: f.expenseCategoryId,
    amount: '100',
    occurred_at: '2026-10-02T15:30:00.000Z',
    note: null,
    rate: '16233000',
    rate_source: 'manual',
    rate_type: null,
    ...overrides,
  };
  const keys = Object.keys(row);
  return connection.pool.query(
    `insert into movements (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
    keys.map((key) => row[key]),
  );
}

describe('DrizzleMovementRepository', () => {
  it('inserts, lists and gets an expense and an income with exact bigint amounts and rates and the UTC instant to the millisecond', async () => {
    const f = await fixture();
    const scope = await writeScope(f.ownerId);
    const amount = 999_999_999_999_999n;
    const rate = RATE_MAX_SCALED - 1n;
    const expense = await repository.insert(
      scope,
      data(f, { amount, rate, occurredAt: new Date('2026-10-02T15:30:00.123Z'), note: 'cena' }),
    );
    const income = await repository.insert(
      scope,
      data(f, {
        type: 'income',
        categoryId: f.incomeCategoryId,
        amount: 1n,
        rateSource: 'automatic',
        rateType: 'blue',
        occurredAt: new Date('2026-10-01T03:00:00.001Z'),
      }),
    );

    expect(expense).toMatchObject({
      ownerId: f.ownerId,
      type: 'expense',
      accountId: f.accountId,
      categoryId: f.expenseCategoryId,
      amount,
      rate,
      rateSource: 'manual',
      rateType: null,
      note: 'cena',
    });
    expect(expense.occurredAt.toISOString()).toBe('2026-10-02T15:30:00.123Z');
    expect(typeof expense.amount).toBe('bigint');
    expect(expense.createdAt).toBeInstanceOf(Date);

    const listed = await repository.list(await readScope(f.ownerId), {
      limit: 50,
      offset: 0,
      filters: {},
    });
    expect(listed.total).toBe(2);
    expect(listed.items).toEqual([expense, income]);
    expect(income).toMatchObject({ type: 'income', rateSource: 'automatic', rateType: 'blue' });
    expect(income.occurredAt.toISOString()).toBe('2026-10-01T03:00:00.001Z');

    expect(await repository.findById(await readScope(f.ownerId), expense.id)).toEqual(expense);
  });

  it('ignores smuggled id, owner and timestamps: the insert picks its fields explicitly', async () => {
    const f = await fixture();
    const other = await fixture('beto@example.com');
    const smuggledId = '11111111-1111-4111-8111-111111111111';
    const loose = {
      ...data(f),
      id: smuggledId,
      ownerId: other.ownerId,
      createdAt: new Date('2000-01-01T00:00:00.000Z'),
      updatedAt: new Date('2000-01-01T00:00:00.000Z'),
    } as unknown as NewMovement;
    const created = await repository.insert(await writeScope(f.ownerId), loose);
    expect(created.id).not.toBe(smuggledId);
    expect(created.ownerId).toBe(f.ownerId);
    expect(created.createdAt.getFullYear()).toBeGreaterThan(2000);
    const stored = await connection.pool.query<{ updated_at: Date }>(
      'select updated_at from movements where id = $1',
      [created.id],
    );
    expect(stored.rows[0]?.updated_at.getFullYear()).toBeGreaterThan(2000);
  });

  it('lets the list query use movements_owner_date_idx for its ordering, with no sort step', async () => {
    const f = await fixture();
    const scope = await writeScope(f.ownerId);
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    for (let i = 0; i < 30; i += 1) {
      await repository.insert(scope, data(f, { occurredAt: new Date(base + i * 60_000) }));
    }
    await connection.pool.query('analyze movements');
    const built = listMovementsQuery(connection.db, await readScope(f.ownerId), {
      limit: 10,
      offset: 0,
      filters: {},
    }).toSQL();
    const client = await connection.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local enable_seqscan = off');
      await client.query('set local enable_sort = off');
      const plan = await client.query<{ 'QUERY PLAN': string }>(
        `explain ${built.sql}`,
        built.params,
      );
      const text = plan.rows.map((row) => row['QUERY PLAN']).join(' ');
      expect(text).toContain('movements_owner_date_idx');
      expect(text).not.toMatch(/\bSort\b/);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('stores an empty or whitespace note as null', async () => {
    const f = await fixture();
    const scope = await writeScope(f.ownerId);
    expect((await repository.insert(scope, data(f, { note: '' }))).note).toBeNull();
    expect((await repository.insert(scope, data(f, { note: '   \t ' }))).note).toBeNull();
    expect((await repository.insert(scope, data(f, { note: 'ok' }))).note).toBe('ok');
  });

  it('orders by date and time, then id, and pages by 100 with a total', async () => {
    const f = await fixture();
    const scope = await writeScope(f.ownerId);
    const base = Date.parse('2026-01-01T00:00:00.000Z');
    // 101 distinct instants plus two rows sharing the newest instant, to exercise the id tie-break.
    for (let i = 0; i < 101; i += 1) {
      await repository.insert(scope, data(f, { occurredAt: new Date(base + i * 60_000) }));
    }
    const tieInstant = new Date(base + 200 * 60_000);
    const tieA = await repository.insert(scope, data(f, { occurredAt: tieInstant }));
    const tieB = await repository.insert(scope, data(f, { occurredAt: tieInstant }));

    const read = await readScope(f.ownerId);
    const first = await repository.list(read, { limit: 100, offset: 0, filters: {} });
    expect(first.total).toBe(103);
    expect(first.items).toHaveLength(100);
    const expectedTies = [tieA.id, tieB.id].sort().reverse();
    expect(first.items.slice(0, 2).map((m) => m.id)).toEqual(expectedTies);
    const times = first.items.map((m) => m.occurredAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const second = await repository.list(read, { limit: 100, offset: 100, filters: {} });
    expect(second.total).toBe(103);
    expect(second.items).toHaveLength(3);
    expect(second.items.at(-1)?.occurredAt.getTime()).toBe(base);
  });

  it("never returns another owner's rows from list or get", async () => {
    const mine = await fixture('ana@example.com');
    const theirs = await fixture('beto@example.com');
    const own = await repository.insert(await writeScope(mine.ownerId), data(mine));
    const other = await repository.insert(await writeScope(theirs.ownerId), data(theirs));

    const listed = await repository.list(await readScope(mine.ownerId), {
      limit: 50,
      offset: 0,
      filters: {},
    });
    expect(listed.total).toBe(1);
    expect(listed.items.map((m) => m.id)).toEqual([own.id]);
    expect(await repository.findById(await readScope(mine.ownerId), other.id)).toBeNull();
    expect(await repository.findById(await readScope(mine.ownerId), own.id)).not.toBeNull();
  });

  describe('check constraints', () => {
    it.each([
      ['an instant before 1970', { occurred_at: '1969-12-31T23:59:59.999Z' }],
      ['an amount of 0', { amount: '0' }],
      ['an amount above the maximum', { amount: '1000000000000001' }],
      ['a rate of 0', { rate: '0' }],
      ['a rate above the maximum', { rate: (RATE_MAX_SCALED + 1n).toString() }],
      ['an unknown type', { type: 'refund' }],
      ['a note of 501 characters', { note: 'x'.repeat(501) }],
      ['an unknown rate source', { rate_source: 'guess' }],
      ['an automatic rate without a type', { rate_source: 'automatic', rate_type: null }],
      ['a manual rate with a type', { rate_source: 'manual', rate_type: 'blue' }],
      ['an unknown rate type', { rate_source: 'automatic', rate_type: 'nope' }],
    ])('the database rejects %s (check violation)', async (_label, overrides) => {
      const f = await fixture();
      expect(await sqlState(() => rawInsert(f, overrides))).toBe('23514');
    });

    it('accepts the bounds: 1970, 1 minor unit, the maximum amount and the maximum rate, a 500-character note', async () => {
      const f = await fixture();
      await rawInsert(f, { occurred_at: '1970-01-01T00:00:00Z', amount: '1', rate: '1' });
      await rawInsert(f, {
        amount: '1000000000000000',
        rate: RATE_MAX_SCALED.toString(),
        note: 'x'.repeat(500),
      });
      const listed = await repository.list(await readScope(f.ownerId), {
        limit: 50,
        offset: 0,
        filters: {},
      });
      expect(listed.total).toBe(2);
    });
  });

  describe('composite foreign keys', () => {
    it('reject a movement whose account belongs to another owner (foreign-key violation, mapped as not found)', async () => {
      const mine = await fixture('ana@example.com');
      const theirs = await fixture('beto@example.com');
      expect(await sqlState(() => rawInsert(mine, { account_id: theirs.accountId }))).toBe('23503');
      await expect(
        repository.insert(
          await writeScope(mine.ownerId),
          data(mine, { accountId: theirs.accountId }),
        ),
      ).rejects.toBeInstanceOf(ResourceNotFound);
    });

    it('reject a movement whose category belongs to another owner', async () => {
      const mine = await fixture('ana@example.com');
      const theirs = await fixture('beto@example.com');
      expect(await sqlState(() => rawInsert(mine, { category_id: theirs.expenseCategoryId }))).toBe(
        '23503',
      );
      await expect(
        repository.insert(
          await writeScope(mine.ownerId),
          data(mine, { categoryId: theirs.expenseCategoryId }),
        ),
      ).rejects.toBeInstanceOf(ResourceNotFound);
    });

    it('reject a movement whose category kind differs from its type (foreign-key violation)', async () => {
      const f = await fixture();
      expect(await sqlState(() => rawInsert(f, { category_id: f.incomeCategoryId }))).toBe('23503');
      expect(
        await sqlState(() => rawInsert(f, { type: 'income', category_id: f.expenseCategoryId })),
      ).toBe('23503');
    });

    it('an insert for an account that was deleted between the read and the insert fails as not found, not as a 500', async () => {
      const f = await fixture();
      await connection.pool.query('delete from accounts where id = $1', [f.accountId]);
      await expect(repository.insert(await writeScope(f.ownerId), data(f))).rejects.toBeInstanceOf(
        ResourceNotFound,
      );
    });

    it('an insert for a category that was deleted fails as not found', async () => {
      const f = await fixture();
      await connection.pool.query('delete from categories where id = $1', [f.expenseCategoryId]);
      await expect(repository.insert(await writeScope(f.ownerId), data(f))).rejects.toBeInstanceOf(
        ResourceNotFound,
      );
    });

    it('rethrows a violation of the key to users, which is not an account or category problem', async () => {
      const f = await fixture();
      const error = await repository
        .insert(await writeScope('00000000-0000-4000-8000-000000000000'), data(f))
        .catch((caught: unknown) => caught);
      expect(error).not.toBeInstanceOf(ResourceNotFound);
      expect(violatedConstraint(error, '23503')).toBeDefined();
    });
  });

  describe('restrict', () => {
    it('deleting an account that has a movement fails with a foreign-key violation and keeps the rows', async () => {
      const f = await fixture();
      const movement = await repository.insert(await writeScope(f.ownerId), data(f));
      const error = await connection.pool
        .query('delete from accounts where id = $1', [f.accountId])
        .catch((caught: unknown) => caught);
      expect(violatedConstraint(error, '23503')).toBe('movements_account_owner_fk');
      const accounts = await connection.pool.query('select 1 from accounts where id = $1', [
        f.accountId,
      ]);
      expect(accounts.rowCount).toBe(1);
      expect(await repository.findById(await readScope(f.ownerId), movement.id)).not.toBeNull();
    });

    it('deleting a category that has a movement fails with a foreign-key violation and keeps the rows', async () => {
      const f = await fixture();
      const movement = await repository.insert(await writeScope(f.ownerId), data(f));
      const error = await connection.pool
        .query('delete from categories where id = $1', [f.expenseCategoryId])
        .catch((caught: unknown) => caught);
      expect(violatedConstraint(error, '23503')).toBe('movements_category_owner_kind_fk');
      const categories = await connection.pool.query('select 1 from categories where id = $1', [
        f.expenseCategoryId,
      ]);
      expect(categories.rowCount).toBe(1);
      expect(await repository.findById(await readScope(f.ownerId), movement.id)).not.toBeNull();
    });
  });

  describe('tags', () => {
    const names = (count: number) => Array.from({ length: count }, (_, i) => `tag-${i}`);

    async function tagRows(ownerId: string): Promise<string[]> {
      const result = await connection.pool.query<{ name: string }>(
        'select name from tags where owner_id = $1 order by name',
        [ownerId],
      );
      return result.rows.map((row) => row.name);
    }

    it('saves 1 and 10 tags and returns them in the given order from insert, list and get, with each tag stored once per user', async () => {
      const f = await fixture();
      const scope = await writeScope(f.ownerId);
      const one = await repository.insert(scope, data(f, { tags: ['Trip'] }));
      const ten = await repository.insert(scope, data(f, { tags: names(10).reverse() }));

      expect(one.tags).toEqual(['Trip']);
      expect(ten.tags).toEqual(names(10).reverse());
      const read = await readScope(f.ownerId);
      const listed = await repository.list(read, { limit: 50, offset: 0, filters: {} });
      expect(listed.items.find((m) => m.id === ten.id)?.tags).toEqual(names(10).reverse());
      expect((await repository.findById(read, one.id))?.tags).toEqual(['Trip']);
      expect(await tagRows(f.ownerId)).toHaveLength(11);
    });

    it('reuses the stored tag for another case on a second movement and displays the first spelling', async () => {
      const f = await fixture();
      const scope = await writeScope(f.ownerId);
      await repository.insert(scope, data(f, { tags: ['Trip'] }));
      const second = await repository.insert(scope, data(f, { tags: ['TRIP', 'other'] }));

      expect(second.tags).toEqual(['Trip', 'other']);
      expect(await tagRows(f.ownerId)).toEqual(['Trip', 'other']);
      const read = await readScope(f.ownerId);
      expect((await repository.findById(read, second.id))?.tags).toEqual(['Trip', 'other']);
    });

    it('collapses two spellings that PostgreSQL folds together into one link', async () => {
      const f = await fixture();
      const created = await repository.insert(
        await writeScope(f.ownerId),
        data(f, { tags: ['Trip', 'trip', 'TRIP'] }),
      );
      expect(created.tags).toEqual(['Trip']);
      const links = await connection.pool.query(
        'select 1 from movement_tags where movement_id = $1',
        [created.id],
      );
      expect(links.rowCount).toBe(1);
    });

    it('keeps one tag row per owner and name: another owner gets its own spelling', async () => {
      const mine = await fixture('ana@example.com');
      const theirs = await fixture('beto@example.com');
      await repository.insert(await writeScope(mine.ownerId), data(mine, { tags: ['Trip'] }));
      const other = await repository.insert(
        await writeScope(theirs.ownerId),
        data(theirs, { tags: ['TRIP'] }),
      );
      expect(other.tags).toEqual(['TRIP']);
      expect(await tagRows(mine.ownerId)).toEqual(['Trip']);
    });

    it('returns an empty array for a movement with no tags, from insert, list and get', async () => {
      const f = await fixture();
      const created = await repository.insert(await writeScope(f.ownerId), data(f));
      const read = await readScope(f.ownerId);
      expect(created.tags).toEqual([]);
      expect((await repository.findById(read, created.id))?.tags).toEqual([]);
      const listed = await repository.list(read, { limit: 50, offset: 0, filters: {} });
      expect(listed.items[0]?.tags).toEqual([]);
    });

    it('rolls back the movement when a tag insert fails (forced error)', async () => {
      const f = await fixture();
      // 31 characters violates tags_name_length_check after the movement row was inserted.
      await expect(
        repository.insert(await writeScope(f.ownerId), data(f, { tags: ['ok', 'x'.repeat(31)] })),
      ).rejects.toBeDefined();
      const movements = await connection.pool.query('select 1 from movements where owner_id = $1', [
        f.ownerId,
      ]);
      expect(movements.rowCount).toBe(0);
      expect(await tagRows(f.ownerId)).toEqual([]);
    });

    it('rolls back the movement and its tags when the account vanished, and answers not found', async () => {
      const f = await fixture();
      await connection.pool.query('delete from accounts where id = $1', [f.accountId]);
      await expect(
        repository.insert(await writeScope(f.ownerId), data(f, { tags: ['Trip'] })),
      ).rejects.toBeInstanceOf(ResourceNotFound);
      expect(await tagRows(f.ownerId)).toEqual([]);
    });

    it('refuses an 11th link, and a link whose tag or movement belongs to another owner (constraint probes)', async () => {
      const mine = await fixture('ana@example.com');
      const theirs = await fixture('beto@example.com');
      const own = await repository.insert(
        await writeScope(mine.ownerId),
        data(mine, { tags: names(10) }),
      );
      const foreign = await repository.insert(await writeScope(theirs.ownerId), data(theirs));
      const lone = await repository.insert(await writeScope(mine.ownerId), data(mine));
      const eleventh = await newTag(connection.pool, mine.ownerId, 'eleventh');
      const foreignTag = await newTag(connection.pool, theirs.ownerId, 'theirs');
      const probe = (movementId: string, tagId: string, ownerId: string, position: number) =>
        sqlState(() =>
          connection.pool.query(
            'insert into movement_tags (movement_id, tag_id, owner_id, position) values ($1, $2, $3, $4)',
            [movementId, tagId, ownerId, position],
          ),
        );

      expect(await probe(own.id, eleventh, mine.ownerId, 10)).toBe('23514');
      expect(await probe(own.id, eleventh, mine.ownerId, 9)).toBe('23505');
      expect(await probe(lone.id, foreignTag, mine.ownerId, 0)).toBe('23503');
      expect(await probe(foreign.id, eleventh, mine.ownerId, 0)).toBe('23503');
      expect(await probe(foreign.id, eleventh, theirs.ownerId, 0)).toBe('23503');
    });

    it('refuses a tag name of 0 and of 31 characters and a second tag equal under lower() for the same owner', async () => {
      const f = await fixture();
      const insertTag = (name: string) =>
        sqlState(() =>
          connection.pool.query('insert into tags (owner_id, name) values ($1, $2)', [
            f.ownerId,
            name,
          ]),
        );
      expect(await insertTag('')).toBe('23514');
      expect(await insertTag('x'.repeat(31))).toBe('23514');
      expect(await insertTag('x'.repeat(30))).toBeUndefined();
      expect(await insertTag('Trip')).toBeUndefined();
      expect(await insertTag('tRIP')).toBe('23505');
    });

    it('loads no tags of a movement of another owner, and findById of a foreign movement stays null', async () => {
      const mine = await fixture('ana@example.com');
      const theirs = await fixture('beto@example.com');
      const foreign = await repository.insert(
        await writeScope(theirs.ownerId),
        data(theirs, { tags: ['secret'] }),
      );
      const read = await readScope(mine.ownerId);
      expect(await repository.findById(read, foreign.id)).toBeNull();
      const listed = await repository.list(read, { limit: 50, offset: 0, filters: {} });
      expect(listed).toEqual({ items: [], total: 0 });
      // The ids of a page are never trusted as proof of ownership: the loader scopes by itself.
      expect((await loadTagsOf(connection.db, read, [foreign.id])).size).toBe(0);
      const owned = await loadTagsOf(connection.db, await readScope(theirs.ownerId), [foreign.id]);
      expect(owned.get(foreign.id)).toEqual(['secret']);
    });
  });
});
