import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CategoryKind } from '@pesly/shared';
import { DrizzleMovementRepository } from '../../src/movements/infrastructure/db/drizzle-movement-repository';
import type {
  MovementFilters,
  NewMovement,
} from '../../src/movements/application/ports/movement-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
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

interface Owner {
  ownerId: string;
  accountId: string;
  otherAccountId: string;
  parentId: string;
  childId: string;
  otherParentId: string;
  incomeId: string;
}

async function subcategory(ownerId: string, parentId: string, kind: CategoryKind) {
  const result = await connection.pool.query<{ id: string }>(
    `insert into categories (owner_id, kind, parent_id, name, icon, color)
     values ($1, $2, $3, 'Child', 'tag', 'blue') returning id`,
    [ownerId, kind, parentId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('No row');
  return row.id;
}

async function owner(): Promise<Owner> {
  const ownerId = await newUserId(connection.db);
  const parentId = await newCategory(connection.pool, ownerId, 'expense');
  return {
    ownerId,
    accountId: await newAccount(connection.pool, ownerId),
    otherAccountId: await newAccount(connection.pool, ownerId),
    parentId,
    childId: await subcategory(ownerId, parentId, 'expense'),
    otherParentId: await newCategory(connection.pool, ownerId, 'expense'),
    incomeId: await newCategory(connection.pool, ownerId, 'income'),
  };
}

type DataOverrides = Partial<{
  type: 'expense' | 'income';
  accountId: string;
  categoryId: string;
  occurredAt: Date;
  note: string | null;
  tags: string[];
}>;

function data(o: Owner, overrides: DataOverrides = {}): NewMovement {
  return {
    type: 'expense',
    accountId: o.accountId,
    categoryId: o.parentId,
    amount: 100n,
    occurredAt: new Date('2026-10-02T15:30:00.000Z'),
    note: null,
    rate: 16_233_000n,
    rateSource: 'manual',
    rateType: null,
    tags: [],
    ...overrides,
  };
}

async function listFor(ownerId: string, filters: MovementFilters, limit = 50) {
  return repository.list(await readScope(ownerId), { limit, offset: 0, filters });
}

describe('movement list filters', () => {
  it('narrows the list by account, category, type, tag and date range, each on its own, with the right total', async () => {
    const o = await owner();
    const scope = await writeScope(o.ownerId);
    const a = await repository.insert(
      scope,
      data(o, { tags: ['Trip'], occurredAt: new Date('2026-10-01T12:00:00Z') }),
    );
    const b = await repository.insert(
      scope,
      data(o, {
        accountId: o.otherAccountId,
        categoryId: o.otherParentId,
        occurredAt: new Date('2026-10-02T12:00:00Z'),
      }),
    );
    const c = await repository.insert(
      scope,
      data(o, {
        type: 'income',
        categoryId: o.incomeId,
        occurredAt: new Date('2026-10-03T12:00:00Z'),
      }),
    );

    expect((await listFor(o.ownerId, {})).total).toBe(3);
    const byAccount = await listFor(o.ownerId, { accountId: o.otherAccountId });
    expect([byAccount.total, byAccount.items.map((m) => m.id)]).toEqual([1, [b.id]]);
    const byCategory = await listFor(o.ownerId, { categoryId: o.incomeId });
    expect([byCategory.total, byCategory.items.map((m) => m.id)]).toEqual([1, [c.id]]);
    const byType = await listFor(o.ownerId, { type: 'income' });
    expect(byType.items.map((m) => m.id)).toEqual([c.id]);
    const byTag = await listFor(o.ownerId, { tag: 'trip' });
    expect([byTag.total, byTag.items.map((m) => m.id)]).toEqual([1, [a.id]]);
    expect(byTag.items[0]?.tags).toEqual(['Trip']);
    const byRange = await listFor(o.ownerId, {
      occurredFrom: new Date('2026-10-02T00:00:00Z'),
      occurredBefore: new Date('2026-10-03T00:00:00Z'),
    });
    expect(byRange.items.map((m) => m.id)).toEqual([b.id]);
    const open = await listFor(o.ownerId, { occurredFrom: new Date('2026-10-02T12:00:00Z') });
    expect(open.items.map((m) => m.id)).toEqual([c.id, b.id]);
  });

  it('with all five filters returns only the movements that match all of them, and the total counts the same set', async () => {
    const o = await owner();
    const scope = await writeScope(o.ownerId);
    const at = new Date('2026-10-02T15:00:00Z');
    const match = await repository.insert(scope, data(o, { tags: ['Trip'], occurredAt: at }));
    await repository.insert(
      scope,
      data(o, { tags: ['Trip'], accountId: o.otherAccountId, occurredAt: at }),
    );
    await repository.insert(
      scope,
      data(o, { tags: ['Trip'], categoryId: o.otherParentId, occurredAt: at }),
    );
    await repository.insert(scope, data(o, { tags: ['Other'], occurredAt: at }));
    await repository.insert(
      scope,
      data(o, { tags: ['Trip'], occurredAt: new Date('2026-10-05T15:00:00Z') }),
    );
    await repository.insert(
      scope,
      data(o, { type: 'income', categoryId: o.incomeId, tags: ['Trip'], occurredAt: at }),
    );

    const result = await listFor(
      o.ownerId,
      {
        accountId: o.accountId,
        categoryId: o.parentId,
        type: 'expense',
        tag: 'TRIP',
        occurredFrom: new Date('2026-10-02T00:00:00Z'),
        occurredBefore: new Date('2026-10-03T00:00:00Z'),
      },
      1,
    );
    expect(result.total).toBe(1);
    expect(result.items.map((m) => m.id)).toEqual([match.id]);
  });

  it('filters by a parent category through its subcategories, and by a subcategory only its own', async () => {
    const o = await owner();
    const scope = await writeScope(o.ownerId);
    const parentMovement = await repository.insert(
      scope,
      data(o, { occurredAt: new Date('2026-10-01T00:00:00Z') }),
    );
    const childMovement = await repository.insert(
      scope,
      data(o, { categoryId: o.childId, occurredAt: new Date('2026-10-02T00:00:00Z') }),
    );
    await repository.insert(scope, data(o, { categoryId: o.otherParentId }));

    const parent = await listFor(o.ownerId, { categoryId: o.parentId });
    expect(parent.total).toBe(2);
    expect(parent.items.map((m) => m.id)).toEqual([childMovement.id, parentMovement.id]);
    const child = await listFor(o.ownerId, { categoryId: o.childId });
    expect(child.items.map((m) => m.id)).toEqual([childMovement.id]);
  });

  it('keeps the local-day interval half open: 23:30 of the day is in, 00:30 of the next day is out', async () => {
    const o = await owner();
    const scope = await writeScope(o.ownerId);
    // Buenos Aires is UTC-3: the local day 2026-10-02 is [03:00Z, next day 03:00Z).
    const inside = await repository.insert(
      scope,
      data(o, { occurredAt: new Date('2026-10-03T02:30:00Z') }),
    );
    await repository.insert(scope, data(o, { occurredAt: new Date('2026-10-03T03:30:00Z') }));
    await repository.insert(scope, data(o, { occurredAt: new Date('2026-10-02T02:59:59Z') }));
    const result = await listFor(o.ownerId, {
      occurredFrom: new Date('2026-10-02T03:00:00Z'),
      occurredBefore: new Date('2026-10-03T03:00:00Z'),
    });
    expect(result.items.map((m) => m.id)).toEqual([inside.id]);
  });

  it("answers an empty page with total 0 for another user's account, category and tag", async () => {
    const mine = await owner();
    const theirs = await owner();
    await repository.insert(await writeScope(mine.ownerId), data(mine, { tags: ['Trip'] }));
    await repository.insert(
      await writeScope(theirs.ownerId),
      data(theirs, { tags: ['secret'], categoryId: theirs.childId }),
    );

    const empty = { items: [], total: 0 };
    expect(await listFor(mine.ownerId, { accountId: theirs.accountId })).toEqual(empty);
    expect(await listFor(mine.ownerId, { categoryId: theirs.parentId })).toEqual(empty);
    expect(await listFor(mine.ownerId, { categoryId: theirs.childId })).toEqual(empty);
    expect(await listFor(mine.ownerId, { tag: 'secret' })).toEqual(empty);
    // The same name used by both users resolves only through the caller's own tag.
    await repository.insert(await writeScope(theirs.ownerId), data(theirs, { tags: ['Trip'] }));
    const own = await listFor(mine.ownerId, { tag: 'trip' });
    expect(own.total).toBe(1);
    expect(own.items.every((m) => m.ownerId === mine.ownerId)).toBe(true);
    // An unknown tag and a random id also match nothing.
    expect(await listFor(mine.ownerId, { tag: 'nonexistent' })).toEqual(empty);
    expect(
      await listFor(mine.ownerId, { accountId: '11111111-1111-4111-8111-111111111111' }),
    ).toEqual(empty);
  });

  it('keeps newest-first order with the filters, and pages with a total of the whole filtered set', async () => {
    const o = await owner();
    const scope = await writeScope(o.ownerId);
    const base = Date.parse('2026-10-01T00:00:00Z');
    for (let i = 0; i < 5; i += 1) {
      await repository.insert(
        scope,
        data(o, { tags: ['Trip'], occurredAt: new Date(base + i * 1000) }),
      );
    }
    await repository.insert(scope, data(o, { occurredAt: new Date(base + 10_000) }));
    const page = await repository.list(await readScope(o.ownerId), {
      limit: 2,
      offset: 1,
      filters: { tag: 'trip' },
    });
    expect(page.total).toBe(5);
    expect(page.items.map((m) => m.occurredAt.getTime())).toEqual([base + 3000, base + 2000]);
  });
});

describe('account filter and transfers or exchanges into the account', () => {
  it('lists a transfer and an exchange whose destination is the filtered account, and not an unrelated one', async () => {
    const o = await owner();
    const usd = await newAccount(connection.pool, o.ownerId, false, 'USD');
    const third = await newAccount(connection.pool, o.ownerId);
    const scope = await writeScope(o.ownerId);
    const expense = await repository.insert(scope, data(o));
    await newTransfer(connection.pool, {
      ownerId: o.ownerId,
      accountId: o.otherAccountId,
      destinationAccountId: o.accountId,
      amount: 200n,
    });
    await newExchange(connection.pool, {
      ownerId: o.ownerId,
      accountId: third,
      destinationAccountId: o.accountId,
      amount: 10n,
      destinationAmount: 15_000n,
      rate: 15_000_000n,
    });
    await newTransfer(connection.pool, {
      ownerId: o.ownerId,
      accountId: o.otherAccountId,
      destinationAccountId: third,
      amount: 5n,
    });
    await newExchange(connection.pool, {
      ownerId: o.ownerId,
      accountId: o.accountId,
      destinationAccountId: usd,
      amount: 15_000n,
      destinationAmount: 10n,
      rate: 15_000_000n,
    });

    const result = await listFor(o.ownerId, { accountId: o.accountId });

    expect(result.total).toBe(4);
    expect(result.items.map((m) => m.type).sort()).toEqual([
      'exchange',
      'exchange',
      'expense',
      'transfer',
    ]);
    expect(result.items.some((m) => m.id === expense.id)).toBe(true);
    expect(
      result.items.filter((m) => 'destinationAccountId' in m && m.destinationAccountId === third),
    ).toEqual([]);
    const intoOnly = await listFor(o.ownerId, { accountId: usd });
    expect(intoOnly.items.map((m) => m.type)).toEqual(['exchange']);
    const typed = await listFor(o.ownerId, { accountId: o.accountId, type: 'transfer' });
    expect(typed.total).toBe(1);
  });

  it("does not match another user's account as a destination either", async () => {
    const mine = await owner();
    const theirs = await owner();
    await newTransfer(connection.pool, {
      ownerId: theirs.ownerId,
      accountId: theirs.otherAccountId,
      destinationAccountId: theirs.accountId,
      amount: 1n,
    });

    expect(await listFor(mine.ownerId, { accountId: theirs.accountId })).toEqual({
      items: [],
      total: 0,
    });
  });
});
