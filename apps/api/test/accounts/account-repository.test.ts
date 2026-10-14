import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AccountCurrency, AccountType } from '@pesly/shared';
import { AccountHasMovements, AccountNameTaken } from '../../src/accounts/domain/errors';
import type { AccountMovements } from '../../src/accounts/application/ports/account-movements';
import type { CreateAccountData } from '../../src/accounts/application/ports/account-repository';
import { DrizzleAccountRepository } from '../../src/accounts/infrastructure/db/drizzle-account-repository';
import { NoMovementsAdapter } from '../../src/accounts/infrastructure/movements/no-movements-adapter';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { Email } from '../../src/identity/domain/email';
import { OwnerOrGroupMemberAccessPolicy, type AccessScope } from '../../src/shared/access';
import { DenyAllGroupMembershipReader } from '../../src/shared/access/infrastructure/deny-all-group-membership-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { violatedConstraint } from '../../src/shared/db/pg-errors';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
let accounts: DrizzleAccountRepository;
let users: DrizzleUserRepository;

const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  accounts = new DrizzleAccountRepository(connection.db);
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

function data(overrides: Partial<CreateAccountData> = {}): CreateAccountData {
  return { name: 'Caja', type: 'cash', currency: 'ARS', openingBalance: 0n, ...overrides };
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

describe('DrizzleAccountRepository', () => {
  it('creates and reads an account with bigint opening balances at the bound without losing precision', async () => {
    const owner = await newUserId('ana@example.com');
    const scope = await writeScope(owner);
    const big = 999_999_999_999_999n; // 10^15 - 1, an odd value close to the bound
    const min = -1_000_000_000_000_000n;

    const created = await accounts.create(
      scope,
      data({ openingBalance: big, includeInAvailable: true }),
    );
    const negative = await accounts.create(
      scope,
      data({ name: 'Deuda', openingBalance: min, includeInAvailable: true }),
    );

    expect(created).toMatchObject({
      name: 'Caja',
      type: 'cash',
      currency: 'ARS',
      openingBalance: big,
      archivedAt: null,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await accounts.findById(scope, created.id)).toEqual(created);
    expect((await accounts.findById(scope, negative.id))?.openingBalance).toBe(min);
    expect(await accounts.listActive(scope)).toEqual(
      expect.arrayContaining([
        {
          id: created.id,
          type: 'cash',
          currency: 'ARS',
          openingBalance: big,
          includeInAvailable: true,
        },
        {
          id: negative.id,
          type: 'cash',
          currency: 'ARS',
          openingBalance: min,
          includeInAvailable: true,
        },
      ]),
    );
  });

  it('works with a read scope for reads', async () => {
    const owner = await newUserId('ana@example.com');
    const created = await accounts.create(await writeScope(owner), data());

    expect(await accounts.findById(await readScope(owner), created.id)).toEqual(created);
  });

  async function updatedAt(id: string): Promise<Date> {
    const result = await connection.pool.query<{ updated_at: Date }>(
      'select updated_at from accounts where id = $1',
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new Error('account row not found');
    return row.updated_at;
  }

  it('rename persists and moves updated_at forward from an earlier timestamp', async () => {
    const owner = await newUserId('ana@example.com');
    const scope = await writeScope(owner);
    const created = await accounts.create(scope, data());
    await connection.pool.query(
      "update accounts set updated_at = now() - interval '1 hour' where id = $1",
      [created.id],
    );
    const before = await updatedAt(created.id);

    const renamed = await accounts.rename(scope, created.id, 'Billetera');

    expect(renamed).toMatchObject({ id: created.id, name: 'Billetera' });
    expect((await accounts.findById(scope, created.id))?.name).toBe('Billetera');
    const after = await updatedAt(created.id);
    expect(after.getTime()).toBeGreaterThan(before.getTime());
    expect(after.getTime()).toBeGreaterThanOrEqual(created.createdAt.getTime());
  });

  it('rename and archive stamp updated_at from the database clock, not the app clock', async () => {
    const owner = await newUserId('ana@example.com');
    const scope = await writeScope(owner);
    const created = await accounts.create(scope, data());
    const other = await accounts.create(scope, data({ name: 'Otra' }));

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2000-01-01T00:00:00Z'));
    try {
      await accounts.rename(scope, created.id, 'Billetera');
      await accounts.setArchived(scope, other.id, true);
    } finally {
      vi.useRealTimers();
    }

    expect((await updatedAt(created.id)).getTime()).toBeGreaterThanOrEqual(
      created.createdAt.getTime(),
    );
    expect((await updatedAt(other.id)).getTime()).toBeGreaterThanOrEqual(other.createdAt.getTime());
    const archived = await accounts.findById(scope, other.id);
    expect(archived?.archivedAt?.getTime()).toBeGreaterThanOrEqual(other.createdAt.getTime());
  });

  it('rename to a name another account of the owner already has raises AccountNameTaken', async () => {
    const owner = await newUserId('ana@example.com');
    const scope = await writeScope(owner);
    await accounts.create(scope, data({ name: 'Caja' }));
    const other = await accounts.create(scope, data({ name: 'Banco' }));

    await expect(accounts.rename(scope, other.id, 'CAJA')).rejects.toBeInstanceOf(AccountNameTaken);
    expect((await accounts.findById(scope, other.id))?.name).toBe('Banco');
  });

  it('archive and unarchive toggle archived_at, and the list separates archived rows', async () => {
    const owner = await newUserId('ana@example.com');
    const scope = await writeScope(owner);
    const kept = await accounts.create(scope, data({ name: 'Activa' }));
    const toArchive = await accounts.create(scope, data({ name: 'Vieja' }));

    const archived = await accounts.setArchived(scope, toArchive.id, true);

    expect(archived?.archivedAt).toBeInstanceOf(Date);
    const again = await accounts.setArchived(scope, toArchive.id, true);
    expect(again?.archivedAt).toEqual(archived?.archivedAt);
    const options = { limit: 50, offset: 0 };
    expect(
      (await accounts.list(scope, { archived: false, ...options })).items.map((a) => a.id),
    ).toEqual([kept.id]);
    expect(
      (await accounts.list(scope, { archived: true, ...options })).items.map((a) => a.id),
    ).toEqual([toArchive.id]);
    expect((await accounts.listActive(scope)).map((a) => a.id)).toEqual([kept.id]);
    expect((await accounts.findById(scope, toArchive.id))?.name).toBe('Vieja');

    const restored = await accounts.setArchived(scope, toArchive.id, false);
    expect(restored?.archivedAt).toBeNull();
    expect((await accounts.listActive(scope)).map((a) => a.id).sort()).toEqual(
      [kept.id, toArchive.id].sort(),
    );
  });

  it('deletes an unreferenced account', async () => {
    const owner = await newUserId('ana@example.com');
    const scope = await writeScope(owner);
    const created = await accounts.create(scope, data());

    expect(await accounts.delete(scope, created.id)).toBe(true);
    expect(await accounts.findById(scope, created.id)).toBeNull();
    expect(await accounts.delete(scope, created.id)).toBe(false);
  });

  it('delete of an account referenced by an ON DELETE RESTRICT table raises AccountHasMovements and keeps the row', async () => {
    await connection.pool.query('drop table if exists test_account_refs');
    await connection.pool.query(
      'create table test_account_refs (id serial primary key, account_id uuid not null references accounts (id) on delete restrict)',
    );
    try {
      const owner = await newUserId('ana@example.com');
      const scope = await writeScope(owner);
      const created = await accounts.create(scope, data());
      await connection.pool.query('insert into test_account_refs (account_id) values ($1)', [
        created.id,
      ]);

      await expect(accounts.delete(scope, created.id)).rejects.toBeInstanceOf(AccountHasMovements);

      expect(await accounts.findById(scope, created.id)).toEqual(created);
    } finally {
      await connection.pool.query('drop table test_account_refs');
    }
  });

  it('Caja and caja for the same owner conflict; the same name for two owners is accepted', async () => {
    const ana = await writeScope(await newUserId('ana@example.com'));
    const bob = await writeScope(await newUserId('bob@example.com'));
    await accounts.create(ana, data({ name: 'Caja' }));

    const duplicate = accounts.create(ana, data({ name: 'caja' }));
    await expect(duplicate).rejects.toBeInstanceOf(AccountNameTaken);
    await expect(duplicate).rejects.not.toHaveProperty('code', '23505');
    await expect(accounts.create(bob, data({ name: 'Caja' }))).resolves.toMatchObject({
      name: 'Caja',
    });
  });

  it('Ñandú and ñandú for the same owner conflict (lower() folds non-ASCII letters)', async () => {
    const ana = await writeScope(await newUserId('ana@example.com'));
    await accounts.create(ana, data({ name: 'Ñandú' }));

    await expect(accounts.create(ana, data({ name: 'ñandú' }))).rejects.toBeInstanceOf(
      AccountNameTaken,
    );
  });

  it('a raw UPDATE of currency, type or owner fails with 23514 and leaves the row unchanged', async () => {
    const owner = await newUserId('ana@example.com');
    const other = await newUserId('bob@example.com');
    const scope = await writeScope(owner);
    const created = await accounts.create(scope, data());

    for (const [column, value] of [
      ['currency', 'USD'],
      ['type', 'savings'],
      ['owner_id', other],
    ] as const) {
      const code = await sqlState(() =>
        connection.pool.query(`update accounts set ${column} = $1 where id = $2`, [
          value,
          created.id,
        ]),
      );
      expect(code, column).toBe('23514');
    }
    expect(await accounts.findById(scope, created.id)).toEqual(created);
    const ok = await connection.pool.query(
      "update accounts set opening_balance = 5, archived_at = now(), name = 'X' where id = $1",
      [created.id],
    );
    expect(ok.rowCount).toBe(1);
  });

  it("another owner's id gives null / false for every method and changes nothing", async () => {
    const ana = await writeScope(await newUserId('ana@example.com'));
    const bobId = await newUserId('bob@example.com');
    const bob = await writeScope(bobId);
    const mine = await accounts.create(ana, data({ name: 'Mia' }));

    expect(await accounts.findById(bob, mine.id)).toBeNull();
    expect(await accounts.findById(await readScope(bobId), mine.id)).toBeNull();
    expect(await accounts.rename(bob, mine.id, 'Robada')).toBeNull();
    expect(await accounts.setArchived(bob, mine.id, true)).toBeNull();
    expect(await accounts.setArchived(bob, mine.id, false)).toBeNull();
    expect(await accounts.delete(bob, mine.id)).toBe(false);
    expect(await accounts.findById(ana, mine.id)).toEqual(mine);
  });

  it('a missing id gives null / false', async () => {
    const scope = await writeScope(await newUserId('ana@example.com'));
    const missing = '00000000-0000-4000-8000-000000000000';

    expect(await accounts.findById(scope, missing)).toBeNull();
    expect(await accounts.rename(scope, missing, 'X')).toBeNull();
    expect(await accounts.setArchived(scope, missing, true)).toBeNull();
    expect(await accounts.delete(scope, missing)).toBe(false);
  });

  it("list returns only the caller's rows ordered by created_at, id, and honours limit and offset", async () => {
    const ana = await writeScope(await newUserId('ana@example.com'));
    const bob = await writeScope(await newUserId('bob@example.com'));
    const created: string[] = [];
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      created.push((await accounts.create(ana, data({ name }))).id);
    }
    await accounts.create(bob, data({ name: 'Ajena' }));

    const all = await accounts.list(ana, { archived: false, limit: 50, offset: 0 });
    const page = await accounts.list(ana, { archived: false, limit: 2, offset: 1 });

    expect(all.total).toBe(5);
    expect(all.items.map((a) => a.id)).toEqual(created);
    expect(page.total).toBe(5);
    expect(page.items.map((a) => a.id)).toEqual(created.slice(1, 3));
    expect(
      (await accounts.list(ana, { archived: false, limit: 10, offset: 10 })).items,
    ).toHaveLength(0);
    expect(await accounts.list(bob, { archived: false, limit: 50, offset: 0 })).toMatchObject({
      total: 1,
    });
  });

  it('list pages are deterministic by id when created_at is identical, with no duplicates or gaps', async () => {
    const ownerId = await newUserId('ana@example.com');
    const ana = await writeScope(ownerId);
    const ids = [
      'f0000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      'a0000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000004',
      'c0000000-0000-4000-8000-000000000005',
    ];
    for (const [index, id] of ids.entries()) {
      await connection.pool.query(
        `insert into accounts (id, owner_id, name, type, currency, opening_balance, include_in_available, created_at)
         values ($1,$2, $3, 'cash', 'ARS', 0, true, '2026-01-01T00:00:00Z')`,
        [id, ownerId, `Cuenta ${String(index)}`],
      );
    }
    const expected = [...ids].sort();

    const pages: string[] = [];
    for (let offset = 0; offset < ids.length; offset += 2) {
      const page = await accounts.list(ana, { archived: false, limit: 2, offset });
      pages.push(...page.items.map((a) => a.id));
    }

    expect(pages).toEqual(expected);
    expect(new Set(pages).size).toBe(ids.length);
  });

  it('listActive returns accounts ordered by created_at, then id', async () => {
    const ownerId = await newUserId('ana@example.com');
    const ana = await writeScope(ownerId);
    const insert = (id: string, createdAt: string) =>
      connection.pool.query(
        `insert into accounts (id, owner_id, name, type, currency, opening_balance, include_in_available, created_at)
         values ($1::uuid, $2, $1::text, 'cash', 'ARS', 0, true, $3)`,
        [id, ownerId, createdAt],
      );
    const late = 'a0000000-0000-4000-8000-00000000000a';
    const tieHigh = 'f0000000-0000-4000-8000-00000000000b';
    const tieLow = '10000000-0000-4000-8000-00000000000c';
    const early = 'f0000000-0000-4000-8000-00000000000d';
    await insert(late, '2026-03-01T00:00:00Z');
    await insert(tieHigh, '2026-02-01T00:00:00Z');
    await insert(tieLow, '2026-02-01T00:00:00Z');
    await insert(early, '2026-01-01T00:00:00Z');

    expect((await accounts.listActive(ana)).map((a) => a.id)).toEqual([
      early,
      tieLow,
      tieHigh,
      late,
    ]);
  });

  it('the check constraints reject a 51-character name, an empty name, a bad type and a bad currency', async () => {
    const owner = await newUserId('ana@example.com');
    const scope = await writeScope(owner);
    const bad = (overrides: Partial<CreateAccountData>) =>
      sqlState(() => accounts.create(scope, data(overrides)));

    expect(await bad({ name: 'x'.repeat(51) })).toBe('23514');
    expect(await bad({ name: '' })).toBe('23514');
    expect(await bad({ type: 'crypto' as AccountType })).toBe('23514');
    expect(await bad({ currency: 'EUR' as AccountCurrency })).toBe('23514');
    expect(await bad({ name: 'x'.repeat(50) })).toBeUndefined();
  });

  it('the opening balance check accepts exactly 10^15 and -10^15 and rejects one more with 23514 (FR-13, AC-19)', async () => {
    const owner = await newUserId('ana@example.com');
    const scope = await writeScope(owner);
    const limit = 10n ** 15n;
    const bad = (name: string, openingBalance: bigint) =>
      sqlState(() => accounts.create(scope, data({ name, openingBalance })));

    expect(await bad('Max', limit)).toBeUndefined();
    expect(await bad('Min', -limit)).toBeUndefined();
    expect(await bad('Over', limit + 1n)).toBe('23514');
    expect(await bad('Under', -limit - 1n)).toBe('23514');
    const names = (await connection.pool.query<{ name: string }>('select name from accounts')).rows;
    expect(names.map((row) => row.name).sort()).toEqual(['Max', 'Min']);
  });

  it('an unexpected driver error propagates unchanged instead of becoming a domain error', async () => {
    const owner = await newUserId('ana@example.com');
    const scope = await writeScope(owner);
    const created = await accounts.create(scope, data());
    // A check violation on rename is neither 23505 nor 23503: it must not be mapped.
    const failure: unknown = await accounts
      .rename(scope, created.id, 'x'.repeat(51))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AccountNameTaken);
    expect(failure).not.toBeInstanceOf(AccountHasMovements);
    expect(
      await sqlState(() => {
        throw failure;
      }),
    ).toBe('23514');
  });
});

describe('DrizzleAccountRepository includeInAvailable', () => {
  async function rawRow(id: string): Promise<{ include: boolean; updatedAt: Date }> {
    const result = await connection.pool.query<{ include: boolean; updated_at: Date }>(
      'select include_in_available as include, updated_at from accounts where id = $1',
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new Error('account row not found');
    return { include: row.include, updatedAt: row.updated_at };
  }

  async function ageUpdatedAt(id: string): Promise<Date> {
    await connection.pool.query(
      "update accounts set updated_at = now() - interval '1 hour' where id = $1",
      [id],
    );
    return (await rawRow(id)).updatedAt;
  }

  it('create persists includeInAvailable and reading returns it, with the type default when omitted (AC-01)', async () => {
    const scope = await writeScope(await newUserId('ana@example.com'));

    const off = await accounts.create(scope, data({ name: 'Off', includeInAvailable: false }));
    const on = await accounts.create(scope, data({ name: 'On', includeInAvailable: true }));
    const card = await accounts.create(
      scope,
      data({ name: 'Visa', type: 'credit_card', includeInAvailable: false }),
    );
    const defaulted = await accounts.create(scope, data({ name: 'Def', type: 'bank_account' }));
    const defaultedSavings = await accounts.create(scope, data({ name: 'Sav', type: 'savings' }));
    const defaultedCard = await accounts.create(scope, data({ name: 'Mc', type: 'credit_card' }));

    expect(off.includeInAvailable).toBe(false);
    expect(on.includeInAvailable).toBe(true);
    expect((await accounts.findById(scope, off.id))?.includeInAvailable).toBe(false);
    expect((await accounts.findById(scope, on.id))?.includeInAvailable).toBe(true);
    expect((await rawRow(on.id)).include).toBe(true);
    expect(card.includeInAvailable).toBe(false);
    expect(defaulted.includeInAvailable).toBe(true);
    expect(defaultedSavings.includeInAvailable).toBe(false);
    expect(defaultedCard.includeInAvailable).toBe(false);
    const listed = await accounts.list(scope, { archived: false, limit: 50, offset: 0 });
    expect(listed.items.find((a) => a.id === off.id)?.includeInAvailable).toBe(false);
  });

  it('setIncludeInAvailable on an active non-card account changes only the setting and updated_at (AC-07)', async () => {
    const scope = await writeScope(await newUserId('ana@example.com'));
    const created = await accounts.create(scope, data({ includeInAvailable: true }));
    const before = await ageUpdatedAt(created.id);

    const result = await accounts.setIncludeInAvailable(scope, created.id, false);

    expect(result).toEqual({
      status: 'updated',
      account: { ...created, includeInAvailable: false },
    });
    const after = await rawRow(created.id);
    expect(after.include).toBe(false);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.getTime());
    expect(await accounts.findById(scope, created.id)).toEqual({
      ...created,
      includeInAvailable: false,
    });
    const back = await accounts.setIncludeInAvailable(scope, created.id, true);
    expect(back).toEqual({ status: 'updated', account: created });
    expect((await rawRow(created.id)).include).toBe(true);
  });

  it('setIncludeInAvailable on a credit card returns credit_card and leaves the row unchanged, archived or not (AC-11)', async () => {
    const scope = await writeScope(await newUserId('ana@example.com'));
    const card = await accounts.create(
      scope,
      data({ name: 'Visa', type: 'credit_card', includeInAvailable: false }),
    );
    const archivedCard = await accounts.create(
      scope,
      data({ name: 'Vieja', type: 'credit_card', includeInAvailable: false }),
    );
    await accounts.setArchived(scope, archivedCard.id, true);
    const beforeCard = await ageUpdatedAt(card.id);
    const beforeArchived = await ageUpdatedAt(archivedCard.id);

    expect(await accounts.setIncludeInAvailable(scope, card.id, true)).toEqual({
      status: 'credit_card',
    });
    expect(await accounts.setIncludeInAvailable(scope, archivedCard.id, true)).toEqual({
      status: 'credit_card',
    });

    expect(await rawRow(card.id)).toEqual({ include: false, updatedAt: beforeCard });
    expect(await rawRow(archivedCard.id)).toEqual({ include: false, updatedAt: beforeArchived });
  });

  it('setIncludeInAvailable on an archived account returns archived and leaves the row unchanged (AC-12)', async () => {
    const scope = await writeScope(await newUserId('ana@example.com'));
    const created = await accounts.create(scope, data({ includeInAvailable: true }));
    await accounts.setArchived(scope, created.id, true);
    const before = await ageUpdatedAt(created.id);

    expect(await accounts.setIncludeInAvailable(scope, created.id, false)).toEqual({
      status: 'archived',
    });

    expect(await rawRow(created.id)).toEqual({ include: true, updatedAt: before });
  });

  it("setIncludeInAvailable on another owner's or a missing account returns not_found and changes nothing (AC-22, NFR-04)", async () => {
    const ana = await writeScope(await newUserId('ana@example.com'));
    const bob = await writeScope(await newUserId('bob@example.com'));
    const mine = await accounts.create(ana, data({ includeInAvailable: true }));
    const before = await ageUpdatedAt(mine.id);

    expect(await accounts.setIncludeInAvailable(bob, mine.id, false)).toEqual({
      status: 'not_found',
    });
    expect(
      await accounts.setIncludeInAvailable(ana, '00000000-0000-4000-8000-000000000000', false),
    ).toEqual({ status: 'not_found' });

    expect(await rawRow(mine.id)).toEqual({ include: true, updatedAt: before });
    // Positive control: the owner reaches the same row, so not_found above came from the scope.
    expect(await accounts.setIncludeInAvailable(ana, mine.id, false)).toMatchObject({
      status: 'updated',
    });
  });

  it('listActive returns type and setting for active accounts only, scoped to the owner (NFR-04)', async () => {
    const ana = await writeScope(await newUserId('ana@example.com'));
    const bob = await writeScope(await newUserId('bob@example.com'));
    const cash = await accounts.create(ana, data({ name: 'Caja', includeInAvailable: true }));
    const savings = await accounts.create(
      ana,
      data({ name: 'Ahorro', type: 'savings', currency: 'USD', includeInAvailable: false }),
    );
    const card = await accounts.create(
      ana,
      data({ name: 'Visa', type: 'credit_card', includeInAvailable: false }),
    );
    const gone = await accounts.create(ana, data({ name: 'Vieja', includeInAvailable: true }));
    await accounts.setArchived(ana, gone.id, true);
    await accounts.create(bob, data({ name: 'Ajena', includeInAvailable: true }));

    expect(await accounts.listActive(ana)).toEqual([
      { id: cash.id, type: 'cash', currency: 'ARS', openingBalance: 0n, includeInAvailable: true },
      {
        id: savings.id,
        type: 'savings',
        currency: 'USD',
        openingBalance: 0n,
        includeInAvailable: false,
      },
      {
        id: card.id,
        type: 'credit_card',
        currency: 'ARS',
        openingBalance: 0n,
        includeInAvailable: false,
      },
    ]);
  });

  it('setting the value an account already has writes nothing and leaves updated_at untouched (AC-07)', async () => {
    const scope = await writeScope(await newUserId('ana@example.com'));
    const included = await accounts.create(scope, data({ name: 'On', includeInAvailable: true }));
    const excluded = await accounts.create(scope, data({ name: 'Off', includeInAvailable: false }));
    const beforeOn = await ageUpdatedAt(included.id);
    const beforeOff = await ageUpdatedAt(excluded.id);

    expect(await accounts.setIncludeInAvailable(scope, included.id, true)).toEqual({
      status: 'updated',
      account: included,
    });
    expect(await accounts.setIncludeInAvailable(scope, excluded.id, false)).toEqual({
      status: 'updated',
      account: excluded,
    });

    expect(await rawRow(included.id)).toEqual({ include: true, updatedAt: beforeOn });
    expect(await rawRow(excluded.id)).toEqual({ include: false, updatedAt: beforeOff });
  });

  it('an archive racing the setting change never leaves an archived account updated (row lock)', async () => {
    const scope = await writeScope(await newUserId('ana@example.com'));
    const created = await accounts.create(scope, data({ includeInAvailable: true }));
    const before = await ageUpdatedAt(created.id);
    const archiver = await connection.pool.connect();
    try {
      await archiver.query('begin');
      await archiver.query('select 1 from accounts where id = $1 for update', [created.id]);

      const pending = accounts.setIncludeInAvailable(scope, created.id, false);
      const state = await Promise.race([
        pending.then(() => {
          return 'settled';
        }),
        new Promise<string>((resolve) =>
          setTimeout(() => {
            resolve('blocked');
          }, 400),
        ),
      ]);
      expect(state).toBe('blocked');

      await archiver.query('update accounts set archived_at = now() where id = $1', [created.id]);
      await archiver.query('commit');

      expect(await pending).toEqual({ status: 'archived' });
      expect(await rawRow(created.id)).toEqual({ include: true, updatedAt: before });
    } finally {
      await archiver.query('rollback').catch(() => undefined);
      archiver.release();
    }
  });
});

describe('violatedConstraint', () => {
  it('returns the constraint of a 23505 or 23503 error found anywhere in the cause chain', () => {
    const unique = Object.assign(new Error('dup'), { code: '23505', constraint: 'a_unique' });
    const foreign = Object.assign(new Error('fk'), { code: '23503', constraint: 'a_fkey' });

    expect(violatedConstraint(new Error('wrapped', { cause: unique }), '23505')).toBe('a_unique');
    expect(violatedConstraint(new Error('wrapped', { cause: foreign }), '23503')).toBe('a_fkey');
  });

  it('returns undefined for another code, a mismatching code or a non-error', () => {
    const unique = Object.assign(new Error('dup'), { code: '23505', constraint: 'a_unique' });
    const check = Object.assign(new Error('chk'), { code: '23514', constraint: 'c' });

    expect(violatedConstraint(unique, '23503')).toBeUndefined();
    expect(violatedConstraint(check, '23505')).toBeUndefined();
    expect(violatedConstraint('boom', '23505')).toBeUndefined();
    expect(violatedConstraint(undefined, '23503')).toBeUndefined();
  });
});

describe('NoMovementsAdapter', () => {
  it('reports no sums and no movements', async () => {
    const adapter: AccountMovements = new NoMovementsAdapter();

    expect((await adapter.sumsByAccount(['a', 'b'])).size).toBe(0);
    expect(await adapter.hasMovements('a')).toBe(false);
  });
});
