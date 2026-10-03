import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RATE_MAX_SCALED } from '@pesly/shared';
import { DrizzleUserDeletionRepository } from '../../src/identity/infrastructure/db/drizzle-user-deletion-repository';
import { eraseUserMovements } from '../../src/movements';
import type { NewMovement } from '../../src/movements/application/ports/movement-repository';
import {
  DrizzleMovementRepository,
  toMovement,
} from '../../src/movements/infrastructure/db/drizzle-movement-repository';
import { ResourceNotFound } from '../../src/shared/access/not-found-unless-allowed';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { violatedConstraint } from '../../src/shared/db/pg-errors';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  newAccount,
  newCategory,
  newExchange,
  newTransfer,
  newUserId,
  readScope,
  writeScope,
} from './db-fixtures';

let connection: DatabaseConnection;
let repository: DrizzleMovementRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleMovementRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

interface Fixture {
  ownerId: string;
  arsId: string;
  ars2Id: string;
  usdId: string;
  expenseCategoryId: string;
}

async function fixture(): Promise<Fixture> {
  const ownerId = await newUserId(connection.db);
  return {
    ownerId,
    arsId: await newAccount(connection.pool, ownerId),
    ars2Id: await newAccount(connection.pool, ownerId),
    usdId: await newAccount(connection.pool, ownerId, false, 'USD'),
    expenseCategoryId: await newCategory(connection.pool, ownerId, 'expense'),
  };
}

function transfer(f: Fixture, overrides: Record<string, unknown> = {}): NewMovement {
  return {
    type: 'transfer',
    accountId: f.arsId,
    destinationAccountId: f.ars2Id,
    amount: 250_000n,
    destinationAmount: 250_000n,
    occurredAt: new Date('2026-10-02T15:30:00.000Z'),
    note: null,
    ...overrides,
  };
}

function exchange(f: Fixture, overrides: Record<string, unknown> = {}): NewMovement {
  return {
    type: 'exchange',
    accountId: f.arsId,
    destinationAccountId: f.usdId,
    amount: 1_500_000n,
    destinationAmount: 1_000n,
    occurredAt: new Date('2026-10-02T15:30:00.000Z'),
    note: null,
    rate: 15_000_000n,
    rateSource: 'implied',
    rateType: null,
    ...overrides,
  };
}

function expense(f: Fixture, overrides: Record<string, unknown> = {}): NewMovement {
  return {
    type: 'expense',
    accountId: f.arsId,
    categoryId: f.expenseCategoryId,
    amount: 12_345n,
    occurredAt: new Date('2026-10-02T15:30:00.000Z'),
    note: null,
    rate: 16_233_000n,
    rateSource: 'manual',
    rateType: null,
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

/** A raw insert bypassing the repository; `null` values are bound as SQL null. */
async function rawInsert(row: Record<string, unknown>): Promise<unknown> {
  const keys = Object.keys(row);
  return connection.pool.query(
    `insert into movements (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
    keys.map((key) => row[key]),
  );
}

function rawTransfer(f: Fixture, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    owner_id: f.ownerId,
    type: 'transfer',
    account_id: f.arsId,
    destination_account_id: f.ars2Id,
    amount: '100',
    destination_amount: '100',
    occurred_at: '2026-10-02T15:30:00.000Z',
    ...overrides,
  };
}

function rawExchange(f: Fixture, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    owner_id: f.ownerId,
    type: 'exchange',
    account_id: f.arsId,
    destination_account_id: f.usdId,
    amount: '1500000',
    destination_amount: '1000',
    occurred_at: '2026-10-02T15:30:00.000Z',
    rate: '15000000',
    rate_source: 'implied',
    ...overrides,
  };
}

describe('transfers and exchanges in the repository', () => {
  it('round-trips a transfer and an exchange through insert, list and get with exact bigints', async () => {
    const f = await fixture();
    const scope = await writeScope(f.ownerId);
    const big = 999_999_999_999_999n;
    const sent = await repository.insert(
      scope,
      transfer(f, { amount: big, destinationAmount: big, note: 'ahorro' }),
    );
    const changed = await repository.insert(
      scope,
      exchange(f, {
        amount: big,
        destinationAmount: 1n,
        rate: RATE_MAX_SCALED,
        occurredAt: new Date('2026-10-01T03:00:00.001Z'),
      }),
    );

    expect(sent).toEqual({
      id: sent.id,
      ownerId: f.ownerId,
      type: 'transfer',
      accountId: f.arsId,
      destinationAccountId: f.ars2Id,
      amount: big,
      destinationAmount: big,
      occurredAt: new Date('2026-10-02T15:30:00.000Z'),
      note: 'ahorro',
      tags: [],
      createdAt: sent.createdAt,
    });
    expect(changed).toEqual({
      id: changed.id,
      ownerId: f.ownerId,
      type: 'exchange',
      accountId: f.arsId,
      destinationAccountId: f.usdId,
      amount: big,
      destinationAmount: 1n,
      rate: RATE_MAX_SCALED,
      rateSource: 'implied',
      rateType: null,
      occurredAt: new Date('2026-10-01T03:00:00.001Z'),
      note: null,
      tags: [],
      createdAt: changed.createdAt,
    });
    expect(typeof changed.amount).toBe('bigint');

    const read = await readScope(f.ownerId);
    expect(await repository.findById(read, sent.id)).toEqual(sent);
    expect(await repository.findById(read, changed.id)).toEqual(changed);
    const listed = await repository.list(read, { limit: 50, offset: 0, filters: {} });
    expect(listed.items).toEqual([sent, changed]);
  });

  it('lists transfers and exchanges with expenses and income, newest first by instant then id', async () => {
    const f = await fixture();
    const scope = await writeScope(f.ownerId);
    const tie = new Date('2026-10-03T10:00:00.000Z');
    const oldest = await repository.insert(
      scope,
      expense(f, { occurredAt: new Date('2026-10-01T10:00:00.000Z') }),
    );
    const tieA = await repository.insert(scope, transfer(f, { occurredAt: tie }));
    const tieB = await repository.insert(scope, exchange(f, { occurredAt: tie }));
    const middle = await repository.insert(
      scope,
      transfer(f, { occurredAt: new Date('2026-10-02T10:00:00.000Z') }),
    );

    const listed = await repository.list(await readScope(f.ownerId), {
      limit: 50,
      offset: 0,
      filters: {},
    });
    expect(listed.total).toBe(4);
    const tieIds = [tieA.id, tieB.id].sort().reverse();
    expect(listed.items.map((m) => m.id)).toEqual([...tieIds, middle.id, oldest.id]);
    expect(listed.items.map((m) => m.type)).toEqual(
      listed.items.map((m) =>
        m.id === tieA.id ? 'transfer' : m.id === tieB.id ? 'exchange' : m.type,
      ),
    );
  });

  it("never returns another owner's transfers and exchanges from list or get", async () => {
    const mine = await fixture();
    const theirs = await fixture();
    const own = await repository.insert(await writeScope(mine.ownerId), transfer(mine));
    const otherTransfer = await repository.insert(
      await writeScope(theirs.ownerId),
      transfer(theirs),
    );
    const otherExchange = await repository.insert(
      await writeScope(theirs.ownerId),
      exchange(theirs),
    );

    const read = await readScope(mine.ownerId);
    const listed = await repository.list(read, { limit: 50, offset: 0, filters: {} });
    expect(listed.items.map((m) => m.id)).toEqual([own.id]);
    expect(listed.total).toBe(1);
    expect(await repository.findById(read, otherTransfer.id)).toBeNull();
    expect(await repository.findById(read, otherExchange.id)).toBeNull();
  });

  it('throws a programming error for a row whose shape is inconsistent, never returning it', () => {
    const base = {
      id: '11111111-1111-4111-8111-111111111111',
      ownerId: '22222222-2222-4222-8222-222222222222',
      accountId: '33333333-3333-4333-8333-333333333333',
      amount: 100n,
      occurredAt: new Date('2026-10-02T15:30:00.000Z'),
      note: null,
      createdAt: new Date('2026-10-02T15:30:00.000Z'),
      categoryId: null,
      destinationAccountId: null,
      destinationAmount: null,
      rate: null,
      rateSource: null,
      rateType: null,
    };
    // A transfer without a destination.
    expect(() => toMovement({ ...base, type: 'transfer' })).toThrow(/inconsistent/i);
    // An expense without a category.
    expect(() => toMovement({ ...base, type: 'expense', rate: 1n, rateSource: 'manual' })).toThrow(
      /inconsistent/i,
    );
    // An exchange without a rate.
    expect(() =>
      toMovement({
        ...base,
        type: 'exchange',
        destinationAccountId: base.accountId,
        destinationAmount: 1n,
      }),
    ).toThrow(/inconsistent/i);
    // A transfer that carries a rate.
    expect(() =>
      toMovement({
        ...base,
        type: 'transfer',
        destinationAccountId: base.accountId,
        destinationAmount: 100n,
        rate: 1n,
      }),
    ).toThrow(/inconsistent/i);
  });

  describe('check constraints', () => {
    it('accepts the three valid shapes', async () => {
      const f = await fixture();
      await rawInsert(rawTransfer(f));
      await rawInsert(rawExchange(f));
      await rawInsert({
        owner_id: f.ownerId,
        type: 'expense',
        account_id: f.arsId,
        category_id: f.expenseCategoryId,
        amount: '5',
        occurred_at: '2026-10-02T15:30:00.000Z',
        rate: '10000',
        rate_source: 'manual',
      });
      await rawInsert(rawExchange(f, { amount: '1', destination_amount: '1', rate: '1' }));
      await rawInsert(
        rawExchange(f, {
          rate: RATE_MAX_SCALED.toString(),
          destination_amount: '1000000000000000',
        }),
      );
      const listed = await repository.list(await readScope(f.ownerId), {
        limit: 50,
        offset: 0,
        filters: {},
      });
      expect(listed.total).toBe(5);
    });

    it.each([
      ['a category', (f: Fixture) => ({ category_id: f.expenseCategoryId })],
      ['a rate', () => ({ rate: '15000000' })],
      ['a rate source', () => ({ rate_source: 'implied' })],
      ['a rate type', () => ({ rate_type: 'blue' })],
      ['a different destination amount', () => ({ destination_amount: '99' })],
      ['no destination account', () => ({ destination_account_id: null })],
      ['no destination amount', () => ({ destination_amount: null })],
    ])('the database rejects a transfer with %s (check violation)', async (_label, make) => {
      const f = await fixture();
      const overrides = make(f);
      // A category needs a matching kind for the key, so the check is what must answer.
      const state = await sqlState(() => rawInsert(rawTransfer(f, overrides)));
      expect(state).toBe('23514');
    });

    it.each([
      ['no rate', () => ({ rate: null, rate_source: null })],
      ['no rate but a source', () => ({ rate: null })],
      ['a rate but no source', () => ({ rate_source: null })],
      ['a manual source', () => ({ rate_source: 'manual' })],
      ['an automatic source', () => ({ rate_source: 'automatic', rate_type: 'blue' })],
      ['a rate type', () => ({ rate_type: 'blue' })],
      ['a category', (f: Fixture) => ({ category_id: f.expenseCategoryId })],
      ['a rate of 0', () => ({ rate: '0' })],
      ['a rate above the maximum', () => ({ rate: (RATE_MAX_SCALED + 1n).toString() })],
      ['no destination amount', () => ({ destination_amount: null })],
      ['no destination account', () => ({ destination_account_id: null })],
    ])('the database rejects an exchange with %s (check violation)', async (_label, make) => {
      const f = await fixture();
      expect(await sqlState(() => rawInsert(rawExchange(f, make(f))))).toBe('23514');
    });

    it.each([
      ['a destination account', (f: Fixture) => ({ destination_account_id: f.ars2Id })],
      ['a destination amount', () => ({ destination_amount: '5' })],
      ['an implied source', () => ({ rate_source: 'implied' })],
      ['no category', () => ({ category_id: null })],
      ['no rate', () => ({ rate: null })],
      ['no rate source', () => ({ rate_source: null })],
      ['an unknown type', () => ({ type: 'refund' })],
    ])('the database rejects an expense with %s (check violation)', async (_label, make) => {
      const f = await fixture();
      const base = {
        owner_id: f.ownerId,
        type: 'expense',
        account_id: f.arsId,
        category_id: f.expenseCategoryId,
        amount: '100',
        occurred_at: '2026-10-02T15:30:00.000Z',
        rate: '16233000',
        rate_source: 'manual',
        ...make(f),
      };
      expect(await sqlState(() => rawInsert(base))).toBe('23514');
    });

    it('rejects a destination equal to the source account', async () => {
      const f = await fixture();
      expect(
        await sqlState(() => rawInsert(rawTransfer(f, { destination_account_id: f.arsId }))),
      ).toBe('23514');
    });

    it.each([['0'], ['1000000000000001'], ['-5']])(
      'rejects an exchange with a destination amount of %s',
      async (value) => {
        const f = await fixture();
        expect(await sqlState(() => rawInsert(rawExchange(f, { destination_amount: value })))).toBe(
          '23514',
        );
      },
    );
  });

  describe('destination key', () => {
    it('rejects a destination account of another owner as a foreign-key violation (insert maps to not found)', async () => {
      const mine = await fixture();
      const theirs = await fixture();
      expect(
        await sqlState(() =>
          rawInsert(rawTransfer(mine, { destination_account_id: theirs.arsId })),
        ),
      ).toBe('23503');
      await expect(
        repository.insert(
          await writeScope(mine.ownerId),
          transfer(mine, { destinationAccountId: theirs.arsId }),
        ),
      ).rejects.toBeInstanceOf(ResourceNotFound);
    });

    it('an insert whose destination was deleted between the read and the insert fails as not found', async () => {
      const f = await fixture();
      await connection.pool.query('delete from accounts where id = $1', [f.usdId]);
      await expect(
        repository.insert(await writeScope(f.ownerId), exchange(f)),
      ).rejects.toBeInstanceOf(ResourceNotFound);
    });

    it('a check violation is rethrown, not mapped to not found', async () => {
      const f = await fixture();
      const error = await repository
        .insert(await writeScope(f.ownerId), transfer(f, { destinationAccountId: f.arsId }))
        .catch((caught: unknown) => caught);
      expect(error).not.toBeInstanceOf(ResourceNotFound);
      expect(error).toMatchObject({ cause: { code: '23514' } });
    });

    it('deleting an account that is only the destination of a movement fails and keeps the rows', async () => {
      const f = await fixture();
      const created = await repository.insert(await writeScope(f.ownerId), transfer(f));
      const error = await connection.pool
        .query('delete from accounts where id = $1', [f.ars2Id])
        .catch((caught: unknown) => caught);
      expect(violatedConstraint(error, '23503')).toBe('movements_destination_owner_fk');
      expect(
        (await connection.pool.query('select 1 from accounts where id = $1', [f.ars2Id])).rowCount,
      ).toBe(1);
      expect(await repository.findById(await readScope(f.ownerId), created.id)).not.toBeNull();
    });
  });

  describe('erasure', () => {
    it("erasing a user removes the user's transfers and exchanges before the accounts", async () => {
      const f = await fixture();
      const other = await fixture();
      await newTransfer(connection.pool, {
        ownerId: f.ownerId,
        accountId: f.arsId,
        destinationAccountId: f.ars2Id,
        amount: 10n,
      });
      await newExchange(connection.pool, {
        ownerId: f.ownerId,
        accountId: f.arsId,
        destinationAccountId: f.usdId,
        amount: 15_000n,
        destinationAmount: 10n,
        rate: 15_000_000n,
      });
      await newTransfer(connection.pool, {
        ownerId: other.ownerId,
        accountId: other.arsId,
        destinationAccountId: other.ars2Id,
        amount: 10n,
      });

      const outcome = await new DrizzleUserDeletionRepository(connection.db, [
        eraseUserMovements,
      ]).erase({ userId: f.ownerId, credentialsVersion: 0 });

      expect(outcome).toBe('erased');
      const left = await connection.pool.query<{ owner_id: string }>(
        'select owner_id from movements',
      );
      expect(left.rows.map((row) => row.owner_id)).toEqual([other.ownerId]);
      expect(
        (await connection.pool.query('select 1 from accounts where owner_id = $1', [f.ownerId]))
          .rowCount,
      ).toBe(0);
    });
  });

  describe('introspection', () => {
    it('has the destination key with the owner column and RESTRICT, and its index', async () => {
      const key = await connection.pool.query<{
        columns: string[];
        foreign_columns: string[];
        on_delete: string;
        target: string;
      }>(
        `select (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord)
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as columns,
                (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord)
                   join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as foreign_columns,
                c.confdeltype as on_delete,
                f.relname as target
           from pg_constraint c join pg_class f on f.oid = c.confrelid
          where c.conname = 'movements_destination_owner_fk'`,
      );
      expect(key.rows).toEqual([
        {
          columns: ['destination_account_id', 'owner_id'],
          foreign_columns: ['id', 'owner_id'],
          on_delete: 'r',
          target: 'accounts',
        },
      ]);
      const index = await connection.pool.query(
        `select 1 from pg_indexes where tablename = 'movements' and indexname = 'movements_destination_idx'`,
      );
      expect(index.rowCount).toBe(1);
    });

    it('has the expected nullability and bigint types for the new and relaxed columns', async () => {
      const result = await connection.pool.query<{
        column_name: string;
        is_nullable: string;
        data_type: string;
      }>(
        `select column_name, is_nullable, data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'movements'
            and column_name in ('category_id', 'rate', 'rate_source', 'destination_account_id', 'destination_amount')`,
      );
      const byName = Object.fromEntries(
        result.rows.map((row) => [row.column_name, [row.is_nullable, row.data_type]]),
      );
      expect(byName).toEqual({
        category_id: ['YES', 'uuid'],
        rate: ['YES', 'bigint'],
        rate_source: ['YES', 'text'],
        destination_account_id: ['YES', 'uuid'],
        destination_amount: ['YES', 'bigint'],
      });
    });

    it('has no float, real, double or numeric column in movements', async () => {
      const result = await connection.pool.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'movements'
            and data_type in ('real', 'double precision', 'numeric', 'money')`,
      );
      expect(result.rows).toEqual([]);
    });
  });
});
