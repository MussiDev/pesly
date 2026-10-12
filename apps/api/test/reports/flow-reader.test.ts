import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FlowWindow } from '../../src/reports/application/ports/flow-reader';
import { DrizzleFlowReader } from '../../src/reports/infrastructure/db/drizzle-flow-reader';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  linkTag,
  newAccount,
  newCategory,
  newExchange,
  newTag,
  newTransfer,
  newUserId,
  readScope,
} from '../movements/db-fixtures';
import {
  newCard,
  newChildCategory,
  newGroup,
  newGroupCategory,
  newGroupExpense,
  newInstallmentPurchase,
  newMember,
  newMovementAt,
  newNamedCategory,
  newStatement,
} from './flow-fixtures';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

let connection: DatabaseConnection;
let reader: DrizzleFlowReader;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  reader = new DrizzleFlowReader(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const WIDE: FlowWindow = {
  from: new Date('2000-01-01T00:00:00Z'),
  before: new Date('2100-01-01T00:00:00Z'),
  timeZone: BUENOS_AIRES,
};

function windowOf(fields: Partial<FlowWindow> = {}): FlowWindow {
  return { ...WIDE, ...fields };
}

async function world() {
  const ana = await newUserId(connection.db);
  return {
    ana,
    scope: await readScope(ana),
    ars: await newAccount(connection.pool, ana, false, 'ARS'),
    usd: await newAccount(connection.pool, ana, false, 'USD'),
    food: await newCategory(connection.pool, ana, 'expense'),
    salary: await newCategory(connection.pool, ana, 'income'),
  };
}

type World = Awaited<ReturnType<typeof world>>;

const expense = (w: World, fields: { amount: bigint; occurredAt: string; accountId?: string }) =>
  newMovementAt(connection.pool, {
    ownerId: w.ana,
    accountId: fields.accountId ?? w.ars,
    categoryId: w.food,
    amount: fields.amount,
    occurredAt: fields.occurredAt,
  });

describe('DrizzleFlowReader.personalRows', () => {
  it('keeps the 20.00 USD expense in USD with its frozen rate, whatever the stored rates become (AC-15, AC-16)', async () => {
    const w = await world();
    await newMovementAt(connection.pool, {
      ownerId: w.ana,
      accountId: w.usd,
      categoryId: w.food,
      amount: 2000n,
      occurredAt: '2026-10-10T15:00:00Z',
      rate: 14000000n,
    });
    await connection.pool.query(
      `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
       values ('mep', 12900000, 13000000, now(), now())
       on conflict (rate_type) do update set buy = excluded.buy, sell = excluded.sell`,
    );
    const before = await reader.personalRows(w.scope, windowOf());

    await connection.pool.query('update exchange_rates set buy = 20000000, sell = 21000000');
    const after = await reader.personalRows(w.scope, windowOf());

    expect(before).toEqual([
      {
        month: '2026-10',
        type: 'expense',
        topCategoryId: w.food,
        currency: 'USD',
        rate: 14000000n,
        sum: 2000n,
        count: 1,
      },
    ]);
    expect(after).toEqual(before);
  });

  it('applies the half-open window to the instants of a Buenos Aires month (AC-14)', async () => {
    const w = await world();
    await expense(w, { amount: 1n, occurredAt: '2026-03-01T02:59:59Z' });
    await expense(w, { amount: 10n, occurredAt: '2026-03-01T03:00:00Z' });
    await expense(w, { amount: 100n, occurredAt: '2026-04-01T02:59:59Z' });
    await expense(w, { amount: 1000n, occurredAt: '2026-04-01T03:00:00Z' });

    const rows = await reader.personalRows(
      w.scope,
      windowOf({
        from: new Date('2026-03-01T03:00:00Z'),
        before: new Date('2026-04-01T03:00:00Z'),
      }),
    );

    expect(rows.map((row) => [row.month, row.sum, row.count])).toEqual([['2026-03', 110n, 2]]);
  });

  it('buckets 01:00 UTC on 1 July in June for Buenos Aires and in July for UTC (AC-28)', async () => {
    const w = await world();
    await expense(w, { amount: 5n, occurredAt: '2026-07-01T01:00:00Z' });

    const buenosAires = await reader.personalRows(w.scope, windowOf());
    const utc = await reader.personalRows(w.scope, windowOf({ timeZone: 'UTC' }));

    expect(buenosAires.map((row) => row.month)).toEqual(['2026-06']);
    expect(utc.map((row) => row.month)).toEqual(['2026-07']);
  });

  it('returns income only from income movements and never transfers or exchanges (AC-22)', async () => {
    const w = await world();
    await expense(w, { amount: 7n, occurredAt: '2026-10-10T15:00:00Z' });
    await newMovementAt(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      categoryId: w.salary,
      amount: 900n,
      occurredAt: '2026-10-10T15:00:00Z',
      type: 'income',
    });
    await newTransfer(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      destinationAccountId: await newAccount(connection.pool, w.ana, false, 'ARS'),
      amount: 5000n,
    });
    await newExchange(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      destinationAccountId: w.usd,
      amount: 14000n,
      destinationAmount: 10n,
      rate: 14000000n,
    });

    const rows = await reader.personalRows(w.scope, windowOf());

    expect(rows.map((row) => [row.type, row.sum]).sort()).toEqual([
      ['expense', 7n],
      ['income', 900n],
    ]);
  });

  it('rolls a subcategory into its top-level category', async () => {
    const w = await world();
    const child = await newChildCategory(connection.pool, w.ana, w.food);
    await newMovementAt(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      categoryId: child,
      amount: 30n,
      occurredAt: '2026-10-10T15:00:00Z',
    });
    await expense(w, { amount: 20n, occurredAt: '2026-10-11T15:00:00Z' });

    const rows = await reader.personalRows(w.scope, windowOf());

    expect(rows.map((row) => [row.topCategoryId, row.sum, row.count])).toEqual([[w.food, 50n, 2]]);
  });

  it('leaves out the payer movement of a group expense (AC-19)', async () => {
    const w = await world();
    const group = await newGroup(connection.pool);
    const me = await newMember(connection.pool, group, w.ana);
    const payerMovement = await expense(w, {
      amount: 3000000n,
      occurredAt: '2026-10-10T15:00:00Z',
    });
    await newGroupExpense(connection.pool, {
      groupId: group,
      payerMemberId: me,
      categoryId: await newGroupCategory(connection.pool, group, { name: 'Dinner' }),
      amount: 3000000n,
      occurredAt: '2026-10-10T15:00:00Z',
      payerMovementId: payerMovement,
      shares: [{ memberId: me, amount: 1000000n }],
    });

    expect(await reader.personalRows(w.scope, windowOf())).toEqual([]);
    const shares = await reader.shareRows(w.scope, windowOf());
    expect(shares.map((row) => [row.sum, row.rate])).toEqual([[1000000n, 14000000n]]);
  });

  it('keeps only the movements with the tag, matched case-insensitively (AC-11)', async () => {
    const w = await world();
    const tagged = await expense(w, { amount: 40n, occurredAt: '2026-10-10T15:00:00Z' });
    await expense(w, { amount: 2n, occurredAt: '2026-10-10T16:00:00Z' });
    const tag = await newTag(connection.pool, w.ana, 'vacations2026');
    await linkTag(connection.pool, { movementId: tagged, tagId: tag, ownerId: w.ana, position: 0 });

    const rows = await reader.personalRows(w.scope, windowOf({ tag: 'Vacations2026' }));

    expect(rows.map((row) => [row.sum, row.count])).toEqual([[40n, 1]]);
  });

  it('keeps only the movements of the account named (AC-12)', async () => {
    const w = await world();
    await expense(w, { amount: 40n, occurredAt: '2026-10-10T15:00:00Z', accountId: w.ars });
    await expense(w, { amount: 2n, occurredAt: '2026-10-10T16:00:00Z', accountId: w.usd });

    const rows = await reader.personalRows(w.scope, windowOf({ accountId: w.usd }));

    expect(rows.map((row) => [row.currency, row.sum])).toEqual([['USD', 2n]]);
  });

  it('never returns the movements of another user (AC-44, AC-46)', async () => {
    const w = await world();
    const bea = await world();
    await expense(bea, { amount: 999n, occurredAt: '2026-10-10T15:00:00Z' });
    await expense(w, { amount: 1n, occurredAt: '2026-10-10T15:00:00Z' });
    await newTag(connection.pool, bea.ana, 'secret');

    const rows = await reader.personalRows(w.scope, windowOf());
    const tagged = await reader.personalRows(w.scope, windowOf({ tag: 'secret' }));

    expect(rows.map((row) => row.sum)).toEqual([1n]);
    expect(tagged).toEqual([]);
  });
});

describe('DrizzleFlowReader.shareRows', () => {
  it('counts 3 shares of one row with count(*) when someone else paid in USD (AC-21)', async () => {
    const w = await world();
    const group = await newGroup(connection.pool);
    const me = await newMember(connection.pool, group, w.ana);
    const other = await newMember(connection.pool, group, null);
    const category = await newGroupCategory(connection.pool, group, { name: 'Trips' });
    for (const day of ['10', '11', '12']) {
      await newGroupExpense(connection.pool, {
        groupId: group,
        payerMemberId: other,
        categoryId: category,
        amount: 3000n,
        currency: 'USD',
        occurredAt: `2026-10-${day}T15:00:00Z`,
        shares: [
          { memberId: me, amount: 1000n },
          { memberId: other, amount: 2000n },
        ],
      });
    }

    const rows = await reader.shareRows(w.scope, windowOf());

    expect(rows).toEqual([
      {
        month: '2026-10',
        categoryName: 'Trips',
        categoryDefaultKey: null,
        currency: 'USD',
        rate: null,
        sum: 3000n,
        count: 3,
      },
    ]);
  });

  it('returns only the caller shares and never those of other users or of other members (AC-44)', async () => {
    const w = await world();
    const bea = await world();
    const group = await newGroup(connection.pool);
    const me = await newMember(connection.pool, group, w.ana);
    const her = await newMember(connection.pool, group, bea.ana);
    const otherGroup = await newGroup(connection.pool);
    const herOnly = await newMember(connection.pool, otherGroup, bea.ana);
    const category = await newGroupCategory(connection.pool, group, { name: 'Food' });
    await newGroupExpense(connection.pool, {
      groupId: group,
      payerMemberId: her,
      categoryId: category,
      amount: 700n,
      occurredAt: '2026-10-10T15:00:00Z',
      shares: [
        { memberId: me, amount: 200n },
        { memberId: her, amount: 500n },
      ],
    });
    await newGroupExpense(connection.pool, {
      groupId: otherGroup,
      payerMemberId: herOnly,
      categoryId: await newGroupCategory(connection.pool, otherGroup, { name: 'Food' }),
      amount: 900n,
      occurredAt: '2026-10-10T15:00:00Z',
      shares: [{ memberId: herOnly, amount: 900n }],
    });

    const rows = await reader.shareRows(w.scope, windowOf());

    expect(rows.map((row) => row.sum)).toEqual([200n]);
  });

  it('applies the window to the instants of the expense', async () => {
    const w = await world();
    const group = await newGroup(connection.pool);
    const me = await newMember(connection.pool, group, w.ana);
    const category = await newGroupCategory(connection.pool, group, { name: 'Food' });
    for (const [at, amount] of [
      ['2026-03-01T02:59:59Z', 1n],
      ['2026-03-01T03:00:00Z', 10n],
      ['2026-04-01T03:00:00Z', 100n],
    ] as const) {
      await newGroupExpense(connection.pool, {
        groupId: group,
        payerMemberId: me,
        categoryId: category,
        amount,
        occurredAt: at,
        shares: [{ memberId: me, amount }],
      });
    }

    const rows = await reader.shareRows(
      w.scope,
      windowOf({
        from: new Date('2026-03-01T03:00:00Z'),
        before: new Date('2026-04-01T03:00:00Z'),
      }),
    );

    expect(rows.map((row) => [row.month, row.sum])).toEqual([['2026-03', 10n]]);
  });
});

describe('DrizzleFlowReader.installmentRows', () => {
  async function cardOf(w: World, days = { closingDay: 25, dueDay: 10 }) {
    return newCard(connection.pool, {
      ownerId: w.ana,
      arsAccountId: w.ars,
      usdAccountId: w.usd,
      ...days,
    });
  }

  it('returns the stored due date of a stored statement, in the category of its purchase (AC-23)', async () => {
    const w = await world();
    const cardId = await cardOf(w);
    await newStatement(connection.pool, {
      cardId,
      ownerId: w.ana,
      period: '2026-10',
      closingDate: '2026-10-26',
      dueDate: '2026-11-10',
    });
    await newInstallmentPurchase(connection.pool, {
      ownerId: w.ana,
      cardId,
      categoryId: w.food,
      installments: [{ period: '2026-10', amount: 1000000n }],
    });

    const rows = await reader.installmentRows(w.scope, '2026-09', '2026-12');

    expect(rows).toEqual([
      {
        period: '2026-10',
        dueDate: '2026-11-10',
        closingDay: 25,
        dueDay: 10,
        topCategoryId: w.food,
        currency: 'ARS',
        rate: null,
        sum: 1000000n,
        count: 1,
      },
    ]);
  });

  it('returns a null due date when no statement is stored and the card days to derive it (AC-23)', async () => {
    const w = await world();
    const cardId = await cardOf(w);
    await newInstallmentPurchase(connection.pool, {
      ownerId: w.ana,
      cardId,
      categoryId: w.food,
      installments: [{ period: '2026-10', amount: 1000000n }],
    });

    const [row] = await reader.installmentRows(w.scope, '2026-10', '2026-10');

    expect(row?.dueDate).toBeNull();
    expect([row?.closingDay, row?.dueDay]).toEqual([25, 10]);
  });

  it('keeps an installment in USD with its currency so the use case can count it (AC-25)', async () => {
    const w = await world();
    const cardId = await cardOf(w);
    await newInstallmentPurchase(connection.pool, {
      ownerId: w.ana,
      cardId,
      categoryId: w.food,
      currency: 'USD',
      installments: [{ period: '2026-10', amount: 100n }],
    });

    const rows = await reader.installmentRows(w.scope, '2026-10', '2026-10');

    expect(rows.map((row) => [row.currency, row.count])).toEqual([['USD', 1]]);
  });

  it('limits the periods and rolls a subcategory into its top-level category', async () => {
    const w = await world();
    const cardId = await cardOf(w);
    const child = await newChildCategory(connection.pool, w.ana, w.food);
    await newInstallmentPurchase(connection.pool, {
      ownerId: w.ana,
      cardId,
      categoryId: child,
      installments: [
        { period: '2026-08', amount: 1n },
        { period: '2026-09', amount: 20n },
        { period: '2026-10', amount: 300n },
        { period: '2026-11', amount: 4000n },
      ],
    });

    const rows = await reader.installmentRows(w.scope, '2026-09', '2026-10');

    expect(rows.map((row) => [row.period, row.topCategoryId, row.sum])).toEqual([
      ['2026-09', w.food, 20n],
      ['2026-10', w.food, 300n],
    ]);
  });

  it('never returns the installments of another user (AC-44, AC-46)', async () => {
    const w = await world();
    const bea = await world();
    await newInstallmentPurchase(connection.pool, {
      ownerId: bea.ana,
      cardId: await cardOf(bea),
      categoryId: bea.food,
      installments: [{ period: '2026-10', amount: 777n }],
    });

    expect(await reader.installmentRows(w.scope, '2026-01', '2026-12')).toEqual([]);
  });
});

describe('DrizzleFlowReader.topCategories', () => {
  it('returns the top-level expense categories of the caller with the names of their children', async () => {
    const w = await world();
    const bea = await world();
    const home = await newNamedCategory(connection.pool, w.ana, { name: 'Home' });
    const defaults = await newNamedCategory(connection.pool, w.ana, {
      name: null,
      defaultKey: 'food',
    });
    const rent = await newChildCategory(connection.pool, w.ana, home, 'Rent');

    const rows = await reader.topCategories(w.scope);
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(home)?.name).toBe('Home');
    expect(byId.get(home)?.children).toEqual([{ name: 'Rent', defaultKey: null }]);
    expect(byId.get(defaults)).toMatchObject({ name: null, defaultKey: 'food', children: [] });
    expect(byId.has(rent)).toBe(false);
    expect(byId.has(w.salary)).toBe(false);
    expect(rows.every((row) => row.id !== bea.food)).toBe(true);
  });
});
