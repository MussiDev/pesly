import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { monthBounds, previousMonth } from '../../src/budgets/domain/month';
import { DrizzleSpendingReader } from '../../src/budgets/infrastructure/db/drizzle-spending-reader';
import type { SpendingWindow } from '../../src/budgets/application/ports/spending-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  newAccount,
  newCategory,
  newExchange,
  newTransfer,
  newUserId,
  readScope,
} from '../movements/db-fixtures';
import {
  newChildCategory,
  newGroup,
  newGroupCategory,
  newGroupExpense,
  newMember,
  newMovementAt,
  statementsOf,
} from './spending-fixtures';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

let connection: DatabaseConnection;
let reader: DrizzleSpendingReader;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  reader = new DrizzleSpendingReader(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

function windowOf(month: string, zone = BUENOS_AIRES, withPrevious = true): SpendingWindow {
  return {
    current: monthBounds(month, zone),
    previous: withPrevious ? monthBounds(previousMonth(month), zone) : null,
  };
}

async function world() {
  const ana = await newUserId(connection.db);
  return {
    ana,
    scope: await readScope(ana),
    ars: await newAccount(connection.pool, ana, false, 'ARS'),
    usd: await newAccount(connection.pool, ana, false, 'USD'),
    food: await newCategory(connection.pool, ana, 'expense'),
    other: await newCategory(connection.pool, ana, 'expense'),
  };
}

describe('DrizzleSpendingReader.personalSpending', () => {
  it('returns the 50,000.00 ARS expense summed in the current bucket with its currency and frozen rate (AC-01)', async () => {
    const w = await world();
    await newMovementAt(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      categoryId: w.food,
      amount: 5000000n,
      occurredAt: '2026-10-10T15:00:00Z',
    });

    const rows = await reader.personalSpending(w.scope, windowOf('2026-10'), [w.food]);

    expect(rows).toEqual([
      {
        categoryId: w.food,
        bucket: 'current',
        currency: 'ARS',
        rate: 14000000n,
        sum: 5000000n,
        count: 1,
      },
    ]);
  });

  it('sums movements of the same category, currency and rate into one row and splits by rate and bucket', async () => {
    const w = await world();
    const base = { ownerId: w.ana, accountId: w.usd, categoryId: w.food };
    await newMovementAt(connection.pool, {
      ...base,
      amount: 1000n,
      occurredAt: '2026-10-05T12:00:00Z',
      rate: 15000000n,
    });
    await newMovementAt(connection.pool, {
      ...base,
      amount: 2500n,
      occurredAt: '2026-10-06T12:00:00Z',
      rate: 15000000n,
    });
    await newMovementAt(connection.pool, {
      ...base,
      amount: 700n,
      occurredAt: '2026-10-07T12:00:00Z',
      rate: 16000000n,
    });
    await newMovementAt(connection.pool, {
      ...base,
      amount: 400n,
      occurredAt: '2026-09-07T12:00:00Z',
      rate: 15000000n,
    });

    const rows = await reader.personalSpending(w.scope, windowOf('2026-10'), [w.food]);
    const key = (row: (typeof rows)[number]) => `${row.bucket}:${row.rate}`;

    expect(rows.map((row) => [key(row), row.currency, row.sum, row.count]).sort()).toEqual([
      ['current:15000000', 'USD', 3500n, 2],
      ['current:16000000', 'USD', 700n, 1],
      ['previous:15000000', 'USD', 400n, 1],
    ]);
  });

  it('returns expenses of every category it is asked for, so the children of a parent come back (AC-02)', async () => {
    const w = await world();
    const child = await newChildCategory(connection.pool, w.ana, w.food);
    for (const categoryId of [w.food, child]) {
      await newMovementAt(connection.pool, {
        ownerId: w.ana,
        accountId: w.ars,
        categoryId,
        amount: 100n,
        occurredAt: '2026-10-10T15:00:00Z',
      });
    }

    const rows = await reader.personalSpending(w.scope, windowOf('2026-10'), [w.food, child]);

    expect(rows.map((row) => row.categoryId).sort()).toEqual([w.food, child].sort());
  });

  it('puts 2026-10-01T01:00Z in September for Buenos Aires and in October for UTC (AC-03)', async () => {
    const w = await world();
    await newMovementAt(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      categoryId: w.food,
      amount: 100n,
      occurredAt: '2026-10-01T01:00:00Z',
    });

    const buenosAires = await reader.personalSpending(w.scope, windowOf('2026-10'), [w.food]);
    const utc = await reader.personalSpending(w.scope, windowOf('2026-10', 'UTC'), [w.food]);

    expect(buenosAires.map((row) => row.bucket)).toEqual(['previous']);
    expect(utc.map((row) => row.bucket)).toEqual(['current']);
  });

  it('leaves out the previous month when the window has none and anything outside the two months', async () => {
    const w = await world();
    for (const occurredAt of [
      '2026-09-10T12:00:00Z',
      '2026-08-10T12:00:00Z',
      '2026-11-10T12:00:00Z',
    ]) {
      await newMovementAt(connection.pool, {
        ownerId: w.ana,
        accountId: w.ars,
        categoryId: w.food,
        amount: 100n,
        occurredAt,
      });
    }

    const withoutPrevious = await reader.personalSpending(
      w.scope,
      windowOf('2026-10', BUENOS_AIRES, false),
      [w.food],
    );
    const withPrevious = await reader.personalSpending(w.scope, windowOf('2026-10'), [w.food]);

    expect(withoutPrevious).toEqual([]);
    expect(withPrevious.map((row) => row.bucket)).toEqual(['previous']);
  });

  it('does not return income, transfers, exchanges, other categories or other users (AC-04, AC-24)', async () => {
    const w = await world();
    const bea = await newUserId(connection.db);
    const beaAccount = await newAccount(connection.pool, bea, false, 'ARS');
    const beaFood = await newCategory(connection.pool, bea, 'expense');
    const income = await newCategory(connection.pool, w.ana, 'income');
    const at = '2026-10-10T15:00:00Z';
    await newMovementAt(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      categoryId: income,
      amount: 100n,
      occurredAt: at,
      type: 'income',
    });
    await newMovementAt(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      categoryId: w.other,
      amount: 100n,
      occurredAt: at,
    });
    await newMovementAt(connection.pool, {
      ownerId: bea,
      accountId: beaAccount,
      categoryId: beaFood,
      amount: 100n,
      occurredAt: at,
    });
    await newTransfer(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      destinationAccountId: await newAccount(connection.pool, w.ana, false, 'ARS'),
      amount: 100n,
    });
    await newExchange(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      destinationAccountId: w.usd,
      amount: 1400000n,
      destinationAmount: 100n,
      rate: 14000000n,
    });

    // Even when asked for the ids of every category, including another user's and the income one,
    // only the caller's expense in a requested category answers.
    const rows = await reader.personalSpending(w.scope, windowOf('2026-10'), [
      w.food,
      w.other,
      income,
      beaFood,
    ]);

    expect(rows.map((row) => row.categoryId)).toEqual([w.other]);
  });

  it('returns USD rows with their frozen rate and never reads exchange_rates (AC-09)', async () => {
    const w = await world();
    await newMovementAt(connection.pool, {
      ownerId: w.ana,
      accountId: w.usd,
      categoryId: w.food,
      amount: 2000n,
      occurredAt: '2026-10-10T15:00:00Z',
      rate: 15000000n,
    });
    const spy = vi.spyOn(connection.pool, 'query');

    const rows = await reader.personalSpending(w.scope, windowOf('2026-10'), [w.food]);
    await reader.shareSpending(w.scope, windowOf('2026-10'));
    const statements = statementsOf(spy.mock.calls);
    spy.mockRestore();

    expect(rows).toMatchObject([{ currency: 'USD', rate: 15000000n, sum: 2000n }]);
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.every((statement) => !statement.text.includes('exchange_rates'))).toBe(true);
  });

  it('excludes the payer movement of a group expense and keeps the share (AC-26)', async () => {
    const w = await world();
    const groupId = await newGroup(connection.pool);
    const anaMember = await newMember(connection.pool, groupId, w.ana);
    const ghost = await newMember(connection.pool, groupId, null);
    const groupCategory = await newGroupCategory(connection.pool, groupId, { name: 'Food' });
    const payerMovement = await newMovementAt(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      categoryId: w.food,
      amount: 3000000n,
      occurredAt: '2026-10-10T15:00:00Z',
    });
    await newGroupExpense(connection.pool, {
      groupId,
      payerMemberId: anaMember,
      categoryId: groupCategory,
      amount: 3000000n,
      occurredAt: '2026-10-10T15:00:00Z',
      payerMovementId: payerMovement,
      shares: [
        { memberId: anaMember, amount: 1000000n },
        { memberId: ghost, amount: 2000000n },
      ],
    });

    const personal = await reader.personalSpending(w.scope, windowOf('2026-10'), [w.food]);
    const shares = await reader.shareSpending(w.scope, windowOf('2026-10'));

    expect(personal).toEqual([]);
    expect(shares).toMatchObject([{ categoryName: 'Food', sum: 1000000n, bucket: 'current' }]);
  });

  it('answers no rows and issues no statement for an empty category list', async () => {
    const w = await world();
    const spy = vi.spyOn(connection.pool, 'query');

    const rows = await reader.personalSpending(w.scope, windowOf('2026-10'), []);
    const issued = spy.mock.calls.length;
    spy.mockRestore();

    expect(rows).toEqual([]);
    expect(issued).toBe(0);
  });

  it('reads afresh on every call: a new September movement changes the rows (AC-21)', async () => {
    const w = await world();
    const first = await reader.personalSpending(w.scope, windowOf('2026-10'), [w.food]);
    await newMovementAt(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      categoryId: w.food,
      amount: 900n,
      occurredAt: '2026-09-20T12:00:00Z',
    });

    const second = await reader.personalSpending(w.scope, windowOf('2026-10'), [w.food]);

    expect(first).toEqual([]);
    expect(second).toMatchObject([{ bucket: 'previous', sum: 900n }]);
  });

  it('issues one statement for 50 categories, never one per budget (NFR-01)', async () => {
    const w = await world();
    const ids: string[] = [];
    for (let index = 0; index < 50; index += 1) {
      ids.push(await newCategory(connection.pool, w.ana, 'expense'));
    }
    const spy = vi.spyOn(connection.pool, 'query');

    await reader.personalSpending(w.scope, windowOf('2026-10'), ids);
    const issued = statementsOf(spy.mock.calls).length;
    spy.mockRestore();

    expect(issued).toBe(1);
  });

  it('rethrows a database failure instead of swallowing it', async () => {
    const w = await world();
    const dead = createDatabase(testDatabaseUrl);
    await dead.pool.end();

    await expect(
      new DrizzleSpendingReader(dead.db).personalSpending(w.scope, windowOf('2026-10'), [w.food]),
    ).rejects.toThrow();
    await expect(
      new DrizzleSpendingReader(dead.db).shareSpending(w.scope, windowOf('2026-10')),
    ).rejects.toThrow();
  });
});

describe('DrizzleSpendingReader.shareSpending', () => {
  async function groupWorld() {
    const w = await world();
    const bea = await newUserId(connection.db);
    const groupId = await newGroup(connection.pool);
    return {
      ...w,
      bea,
      groupId,
      anaMember: await newMember(connection.pool, groupId, w.ana),
      beaMember: await newMember(connection.pool, groupId, bea),
      foodCategory: await newGroupCategory(connection.pool, groupId, { name: 'Food' }),
    };
  }

  it('returns the 10,000.00 ARS share of an expense paid by someone else, with its name (AC-01, AC-10)', async () => {
    const g = await groupWorld();
    await newGroupExpense(connection.pool, {
      groupId: g.groupId,
      payerMemberId: g.beaMember,
      categoryId: g.foodCategory,
      amount: 2000000n,
      occurredAt: '2026-10-12T15:00:00Z',
      shares: [
        { memberId: g.anaMember, amount: 1000000n },
        { memberId: g.beaMember, amount: 1000000n },
      ],
    });

    const rows = await reader.shareSpending(g.scope, windowOf('2026-10'));

    expect(rows).toEqual([
      {
        categoryName: 'Food',
        categoryDefaultKey: null,
        bucket: 'current',
        currency: 'ARS',
        rate: null,
        sum: 1000000n,
        count: 1,
      },
    ]);
  });

  it('returns the default key of a default group category that has no custom name (AC-10)', async () => {
    const g = await groupWorld();
    const defaultCategory = await newGroupCategory(connection.pool, g.groupId, {
      name: null,
      defaultKey: 'food',
    });
    await newGroupExpense(connection.pool, {
      groupId: g.groupId,
      payerMemberId: g.beaMember,
      categoryId: defaultCategory,
      amount: 100n,
      occurredAt: '2026-10-12T15:00:00Z',
      shares: [{ memberId: g.anaMember, amount: 100n }],
    });

    const rows = await reader.shareSpending(g.scope, windowOf('2026-10'));

    expect(rows).toMatchObject([{ categoryName: null, categoryDefaultKey: 'food', sum: 100n }]);
  });

  it('carries the payer movement rate only when the caller paid (AC-12)', async () => {
    const g = await groupWorld();
    const payerMovement = await newMovementAt(connection.pool, {
      ownerId: g.ana,
      accountId: g.usd,
      categoryId: g.food,
      amount: 4000n,
      occurredAt: '2026-10-12T15:00:00Z',
      rate: 15500000n,
    });
    await newGroupExpense(connection.pool, {
      groupId: g.groupId,
      payerMemberId: g.anaMember,
      categoryId: g.foodCategory,
      amount: 4000n,
      currency: 'USD',
      occurredAt: '2026-10-12T15:00:00Z',
      payerMovementId: payerMovement,
      shares: [
        { memberId: g.anaMember, amount: 2000n },
        { memberId: g.beaMember, amount: 2000n },
      ],
    });
    await newGroupExpense(connection.pool, {
      groupId: g.groupId,
      payerMemberId: g.beaMember,
      categoryId: g.foodCategory,
      amount: 6000n,
      currency: 'USD',
      occurredAt: '2026-10-13T15:00:00Z',
      shares: [
        { memberId: g.anaMember, amount: 3000n },
        { memberId: g.beaMember, amount: 3000n },
      ],
    });

    const rows = await reader.shareSpending(g.scope, windowOf('2026-10'));

    expect(rows.map((row) => [row.currency, row.rate, row.sum])).toEqual(
      expect.arrayContaining([
        ['USD', 15500000n, 2000n],
        ['USD', null, 3000n],
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it('puts a share in the bucket of its own month in the user zone (AC-03)', async () => {
    const g = await groupWorld();
    await newGroupExpense(connection.pool, {
      groupId: g.groupId,
      payerMemberId: g.beaMember,
      categoryId: g.foodCategory,
      amount: 100n,
      occurredAt: '2026-10-01T01:00:00Z',
      shares: [{ memberId: g.anaMember, amount: 100n }],
    });

    const buenosAires = await reader.shareSpending(g.scope, windowOf('2026-10'));
    const utc = await reader.shareSpending(g.scope, windowOf('2026-10', 'UTC'));

    expect(buenosAires.map((row) => row.bucket)).toEqual(['previous']);
    expect(utc.map((row) => row.bucket)).toEqual(['current']);
  });

  it('ignores shares of 0, groups the caller is not in, and expenses outside the window (AC-24)', async () => {
    const g = await groupWorld();
    await newGroupExpense(connection.pool, {
      groupId: g.groupId,
      payerMemberId: g.beaMember,
      categoryId: g.foodCategory,
      amount: 100n,
      occurredAt: '2026-10-12T15:00:00Z',
      shares: [
        { memberId: g.anaMember, amount: 0n },
        { memberId: g.beaMember, amount: 100n },
      ],
    });
    await newGroupExpense(connection.pool, {
      groupId: g.groupId,
      payerMemberId: g.beaMember,
      categoryId: g.foodCategory,
      amount: 100n,
      occurredAt: '2026-07-12T15:00:00Z',
      shares: [{ memberId: g.anaMember, amount: 100n }],
    });
    const otherGroup = await newGroup(connection.pool);
    const strangerA = await newMember(connection.pool, otherGroup, g.bea);
    const strangerB = await newMember(connection.pool, otherGroup, null);
    const otherCategory = await newGroupCategory(connection.pool, otherGroup, { name: 'Food' });
    await newGroupExpense(connection.pool, {
      groupId: otherGroup,
      payerMemberId: strangerA,
      categoryId: otherCategory,
      amount: 100n,
      occurredAt: '2026-10-12T15:00:00Z',
      shares: [
        { memberId: strangerA, amount: 50n },
        { memberId: strangerB, amount: 50n },
      ],
    });

    const rows = await reader.shareSpending(g.scope, windowOf('2026-10'));

    expect(rows).toEqual([]);
  });

  it('issues a single statement whatever the number of groups (NFR-01)', async () => {
    const g = await groupWorld();
    for (let index = 0; index < 5; index += 1) {
      const groupId = await newGroup(connection.pool);
      await newMember(connection.pool, groupId, g.ana);
    }
    const spy = vi.spyOn(connection.pool, 'query');

    await reader.shareSpending(g.scope, windowOf('2026-10'));
    const issued = statementsOf(spy.mock.calls).length;
    spy.mockRestore();

    expect(issued).toBe(1);
  });
});
