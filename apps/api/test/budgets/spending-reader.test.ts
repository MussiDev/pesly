import { statementDueMonth } from '@pesly/shared';
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
import { newCard, newInstallmentPurchase, newStatement } from '../reports/flow-fixtures';
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

/** A card closing on the 24th and due on the 5th; Sep and Oct statements stored unless told not to. */
async function cardWorld(
  options: { statements?: boolean; closingDay?: number; dueDay?: number } = {},
) {
  const w = await world();
  const bank = await newAccount(connection.pool, w.ana, false, 'ARS');
  const cardId = await newCard(connection.pool, {
    ownerId: w.ana,
    arsAccountId: w.ars,
    usdAccountId: w.usd,
    closingDay: options.closingDay ?? 24,
    dueDay: options.dueDay ?? 5,
  });
  if (options.statements !== false) {
    await newStatement(connection.pool, {
      cardId,
      ownerId: w.ana,
      period: '2026-09',
      closingDate: '2026-09-24',
      dueDate: '2026-10-05',
    });
    await newStatement(connection.pool, {
      cardId,
      ownerId: w.ana,
      period: '2026-10',
      closingDate: '2026-10-24',
      dueDate: '2026-11-05',
    });
  }
  return { ...w, bank, cardId };
}

type CardWorld = Awaited<ReturnType<typeof cardWorld>>;

const cardExpense = (
  w: CardWorld,
  fields: { amount: bigint; occurredAt: string; accountId?: string; rate?: bigint },
) =>
  newMovementAt(connection.pool, {
    ownerId: w.ana,
    accountId: fields.accountId ?? w.ars,
    categoryId: w.food,
    amount: fields.amount,
    occurredAt: fields.occurredAt,
    ...(fields.rate === undefined ? {} : { rate: fields.rate }),
  });

const cardRows = (w: CardWorld, month = '2026-10', categoryIds: string[] = [w.food]) =>
  reader.cardPurchaseSpending(w.scope, windowOf(month), categoryIds, BUENOS_AIRES);

describe('DrizzleSpendingReader.cardPurchaseSpending', () => {
  it('returns the 30,000.00 ARS purchase of 2026-09-20 on the statement due 5 Oct, so it counts in October and not September (AC-01, AC-07)', async () => {
    const w = await cardWorld();
    await cardExpense(w, { amount: 3000000n, occurredAt: '2026-09-20T15:00:00Z' });

    const rows = await cardRows(w);

    expect(rows).toEqual([
      {
        categoryId: w.food,
        currency: 'ARS',
        rate: 14000000n,
        sum: 3000000n,
        count: 1,
        period: '2026-09',
        dueDate: '2026-10-05',
        closingDay: 24,
        dueDay: 5,
      },
    ]);
    expect(rows.map((row) => statementDueMonth(row))).toEqual(['2026-10']);
  });

  it('puts a purchase dated 2026-09-25 on the next statement (AC-03)', async () => {
    const w = await cardWorld();
    await cardExpense(w, { amount: 100n, occurredAt: '2026-09-25T15:00:00Z' });

    const rows = await cardRows(w, '2026-11');

    expect(rows.map((row) => [row.period, row.dueDate])).toEqual([['2026-10', '2026-11-05']]);
  });

  it('returns the edited stored due date, which moves the purchase to that month (AC-04)', async () => {
    const w = await cardWorld({ statements: false });
    await newStatement(connection.pool, {
      cardId: w.cardId,
      ownerId: w.ana,
      period: '2026-09',
      closingDate: '2026-09-24',
      dueDate: '2026-11-12',
    });
    await cardExpense(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });

    const rows = await cardRows(w, '2026-11');

    expect(rows.map((row) => [row.dueDate, statementDueMonth(row)])).toEqual([
      ['2026-11-12', '2026-11'],
    ]);
  });

  it('returns a null due date and the card days when the statement is not stored, so the use case computes it (AC-05)', async () => {
    const w = await cardWorld({ statements: false });
    await cardExpense(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });

    const rows = await cardRows(w);

    expect(rows.map((row) => [row.period, row.dueDate, row.closingDay, row.dueDay])).toEqual([
      ['2026-09', null, 24, 5],
    ]);
    expect(rows.map((row) => statementDueMonth(row))).toEqual(['2026-10']);
  });

  it('returns only rows whose due month is inside the two months of the window', async () => {
    const w = await cardWorld({ statements: false });
    for (const [period, closingDate, dueDate] of [
      ['2026-07', '2026-07-24', '2026-08-05'],
      ['2026-08', '2026-08-24', '2026-09-05'],
      ['2026-10', '2026-10-24', '2026-11-05'],
      ['2026-11', '2026-11-24', '2026-12-05'],
    ] as const) {
      await newStatement(connection.pool, {
        cardId: w.cardId,
        ownerId: w.ana,
        period,
        closingDate,
        dueDate,
      });
    }
    await cardExpense(w, { amount: 1n, occurredAt: '2026-07-20T15:00:00Z' }); // due Aug: out
    await cardExpense(w, { amount: 2n, occurredAt: '2026-08-20T15:00:00Z' }); // due Sep: in
    await cardExpense(w, { amount: 4n, occurredAt: '2026-10-20T15:00:00Z' }); // due Nov: out
    await cardExpense(w, { amount: 8n, occurredAt: '2026-11-20T15:00:00Z' }); // due Dec: out

    const rows = await cardRows(w);

    expect(rows.map((row) => [row.period, row.sum])).toEqual([['2026-08', 2n]]);
  });

  it('reads no purchase-date bound: a purchase older than the window belongs to its statement (AC-01)', async () => {
    const w = await cardWorld({ statements: false });
    await newStatement(connection.pool, {
      cardId: w.cardId,
      ownerId: w.ana,
      period: '2026-09',
      closingDate: '2026-09-24',
      dueDate: '2026-10-05',
    });
    await cardExpense(w, { amount: 100n, occurredAt: '2026-03-10T15:00:00Z' });

    const rows = await cardRows(w);

    expect(rows.map((row) => [row.period, row.sum])).toEqual([['2026-09', 100n]]);
  });

  it('returns a purchase of 20.00 USD with its frozen rate (AC-09)', async () => {
    const w = await cardWorld();
    await cardExpense(w, {
      amount: 2000n,
      occurredAt: '2026-09-20T15:00:00Z',
      accountId: w.usd,
      rate: 15000000n,
    });

    const rows = await cardRows(w);

    expect(rows).toMatchObject([{ currency: 'USD', rate: 15000000n, sum: 2000n }]);
  });

  it('groups by the frozen rate and sums a statement and category into one row', async () => {
    const w = await cardWorld();
    await cardExpense(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });
    await cardExpense(w, { amount: 50n, occurredAt: '2026-09-21T15:00:00Z' });
    await cardExpense(w, { amount: 7n, occurredAt: '2026-09-22T15:00:00Z', rate: 15000000n });

    const rows = await cardRows(w);

    expect(rows.map((row) => [row.rate, row.sum, row.count]).sort()).toEqual([
      [14000000n, 150n, 2],
      [15000000n, 7n, 1],
    ]);
  });

  it('still returns the purchase of a card whose days give no valid cycle, and does not fail (AC-14)', async () => {
    const w = await cardWorld({ statements: false, closingDay: 31, dueDay: 31 });
    await cardExpense(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });

    const rows = await cardRows(w);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.dueDate).toBeNull();
  });

  it('places a purchase after the last stored statement in the cycle after it, never in a stored one (AC-05)', async () => {
    const w = await cardWorld({ statements: false });
    await newStatement(connection.pool, {
      cardId: w.cardId,
      ownerId: w.ana,
      period: '2026-09',
      closingDate: '2026-09-08',
      dueDate: '2026-10-05',
    });
    await cardExpense(w, { amount: 100n, occurredAt: '2026-09-10T15:00:00Z' });

    const rows = await cardRows(w, '2026-11');

    expect(rows.map((row) => [row.period, row.dueDate])).toEqual([['2026-10', null]]);
  });

  it('does not return an expense on a bank account, income, transfers or exchanges, and a statement payment appears in no read (AC-06, AC-08)', async () => {
    const w = await cardWorld();
    const salary = await newCategory(connection.pool, w.ana, 'income');
    await cardExpense(w, {
      amount: 800000n,
      occurredAt: '2026-09-20T15:00:00Z',
      accountId: w.bank,
    });
    await newMovementAt(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      categoryId: salary,
      amount: 5n,
      occurredAt: '2026-09-20T15:00:00Z',
      type: 'income',
    });
    await newTransfer(connection.pool, {
      ownerId: w.ana,
      accountId: w.bank,
      destinationAccountId: w.ars,
      amount: 3000000n,
    });
    await newExchange(connection.pool, {
      ownerId: w.ana,
      accountId: w.bank,
      destinationAccountId: w.usd,
      amount: 140000n,
      destinationAmount: 100n,
      rate: 14000000n,
    });

    expect(await cardRows(w, '2026-10', [w.food, salary])).toEqual([]);
    expect(await reader.personalSpending(w.scope, windowOf('2026-10'), [w.food])).toMatchObject([
      { bucket: 'previous', sum: 800000n },
    ]);
    expect(await reader.personalSpending(w.scope, windowOf('2026-10'), [salary])).toEqual([]);
  });

  it('returns the exact category only, with no roll-up to a parent', async () => {
    const w = await cardWorld();
    const child = await newChildCategory(connection.pool, w.ana, w.food);
    for (const categoryId of [w.food, child, w.other]) {
      await newMovementAt(connection.pool, {
        ownerId: w.ana,
        accountId: w.ars,
        categoryId,
        amount: 10n,
        occurredAt: '2026-09-20T15:00:00Z',
      });
    }

    expect((await cardRows(w, '2026-10', [child])).map((row) => row.categoryId)).toEqual([child]);
    expect((await cardRows(w, '2026-10', [w.food])).map((row) => row.categoryId)).toEqual([w.food]);
  });

  it('leaves out the payer movement of a group expense, whose share counts instead', async () => {
    const w = await cardWorld();
    const payerMovement = await cardExpense(w, {
      amount: 4000000n,
      occurredAt: '2026-09-20T15:00:00Z',
    });
    await cardExpense(w, { amount: 100n, occurredAt: '2026-09-21T15:00:00Z' });
    const groupId = await newGroup(connection.pool);
    const me = await newMember(connection.pool, groupId, w.ana);
    await newGroupExpense(connection.pool, {
      groupId,
      payerMemberId: me,
      categoryId: await newGroupCategory(connection.pool, groupId, { name: 'Food' }),
      amount: 4000000n,
      occurredAt: '2026-09-20T15:00:00Z',
      payerMovementId: payerMovement,
      shares: [{ memberId: me, amount: 4000000n }],
    });

    expect((await cardRows(w)).map((row) => row.sum)).toEqual([100n]);
  });

  it("never returns another user's card purchase (AC-16)", async () => {
    const mine = await cardWorld();
    const other = await cardWorld();
    await cardExpense(other, { amount: 9999n, occurredAt: '2026-09-20T15:00:00Z' });

    expect(await cardRows(mine, '2026-10', [mine.food, other.food])).toEqual([]);
    expect((await cardRows(other)).map((row) => row.sum)).toEqual([9999n]);
  });

  it('reads an already stored purchase under the new rule, with no migration step (AC-12)', async () => {
    const w = await cardWorld();
    await cardExpense(w, { amount: 3000000n, occurredAt: '2026-09-20T15:00:00Z' });

    // Nothing is written between the insert and the read: the placement is computed on read.
    expect((await cardRows(w)).map((row) => row.dueDate)).toEqual(['2026-10-05']);
  });

  it('adds a card-account expense to exactly one of personalSpending and cardPurchaseSpending', async () => {
    const w = await cardWorld();
    await cardExpense(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });
    await cardExpense(w, { amount: 200n, occurredAt: '2026-09-20T15:00:00Z', accountId: w.bank });

    const personal = await reader.personalSpending(w.scope, windowOf('2026-10'), [w.food]);
    const card = await cardRows(w);

    expect(personal.map((row) => row.sum)).toEqual([200n]);
    expect(card.map((row) => row.sum)).toEqual([100n]);
  });

  it('answers no rows and issues no statement for an empty category list', async () => {
    const w = await cardWorld();
    const spy = vi.spyOn(connection.pool, 'query');

    const rows = await cardRows(w, '2026-10', []);
    const issued = spy.mock.calls.length;
    spy.mockRestore();

    expect(rows).toEqual([]);
    expect(issued).toBe(0);
  });

  it('rethrows a database failure instead of swallowing it', async () => {
    const w = await cardWorld();
    const dead = createDatabase(testDatabaseUrl);
    await dead.pool.end();

    await expect(
      new DrizzleSpendingReader(dead.db).cardPurchaseSpending(
        w.scope,
        windowOf('2026-10'),
        [w.food],
        BUENOS_AIRES,
      ),
    ).rejects.toThrow();
  });
});

describe('DrizzleSpendingReader.installmentSpending', () => {
  const installmentRows = (w: CardWorld, month = '2026-10', categoryIds: string[] = [w.food]) =>
    reader.installmentSpending(w.scope, windowOf(month), categoryIds);

  it('returns 10,000.00 ARS for each statement of a 60,000.00 ARS purchase in 6 installments (AC-02)', async () => {
    const w = await cardWorld({ statements: false });
    for (const [period, closingDate, dueDate] of [
      ['2026-07', '2026-07-24', '2026-08-05'],
      ['2026-08', '2026-08-24', '2026-09-05'],
      ['2026-09', '2026-09-24', '2026-10-05'],
      ['2026-10', '2026-10-24', '2026-11-05'],
    ] as const) {
      await newStatement(connection.pool, {
        cardId: w.cardId,
        ownerId: w.ana,
        period,
        closingDate,
        dueDate,
      });
    }
    await newInstallmentPurchase(connection.pool, {
      ownerId: w.ana,
      cardId: w.cardId,
      categoryId: w.food,
      installments: ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'].map(
        (period) => ({ period, amount: 1000000n }),
      ),
    });

    const rows = await installmentRows(w);

    // Window Sep..Oct: the statements due in September (period 2026-08) and October (2026-09).
    expect(rows.map((row) => [row.period, row.dueDate, row.sum, row.count])).toEqual(
      expect.arrayContaining([
        ['2026-08', '2026-09-05', 1000000n, 1],
        ['2026-09', '2026-10-05', 1000000n, 1],
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.currency === 'ARS' && row.categoryId === w.food)).toBe(true);
  });

  it('returns the installment of a statement not stored with a null due date and the card days (AC-05)', async () => {
    const w = await cardWorld({ statements: false });
    await newInstallmentPurchase(connection.pool, {
      ownerId: w.ana,
      cardId: w.cardId,
      categoryId: w.food,
      installments: [{ period: '2026-09', amount: 500n }],
    });

    const rows = await installmentRows(w);

    expect(rows).toEqual([
      {
        categoryId: w.food,
        currency: 'ARS',
        sum: 500n,
        count: 1,
        period: '2026-09',
        dueDate: null,
        closingDay: 24,
        dueDay: 5,
      },
    ]);
  });

  it('moves an installment to the month of an edited stored due date (AC-04)', async () => {
    const w = await cardWorld({ statements: false });
    await newStatement(connection.pool, {
      cardId: w.cardId,
      ownerId: w.ana,
      period: '2026-09',
      closingDate: '2026-09-24',
      dueDate: '2026-11-12',
    });
    await newInstallmentPurchase(connection.pool, {
      ownerId: w.ana,
      cardId: w.cardId,
      categoryId: w.food,
      installments: [{ period: '2026-09', amount: 500n }],
    });

    const rows = await installmentRows(w, '2026-11');

    expect(rows.map((row) => statementDueMonth(row))).toEqual(['2026-11']);
  });

  it('keeps an installment in USD with its own currency and counts the rows', async () => {
    const w = await cardWorld();
    await newInstallmentPurchase(connection.pool, {
      ownerId: w.ana,
      cardId: w.cardId,
      categoryId: w.food,
      currency: 'USD',
      installments: [{ period: '2026-09', amount: 1000n }],
    });
    await newInstallmentPurchase(connection.pool, {
      ownerId: w.ana,
      cardId: w.cardId,
      categoryId: w.food,
      currency: 'USD',
      installments: [{ period: '2026-09', amount: 250n }],
    });

    expect(await installmentRows(w)).toMatchObject([{ currency: 'USD', sum: 1250n, count: 2 }]);
  });

  it('returns the exact category of the purchase only, with no roll-up to a parent', async () => {
    const w = await cardWorld();
    const child = await newChildCategory(connection.pool, w.ana, w.food);
    for (const categoryId of [w.food, child, w.other]) {
      await newInstallmentPurchase(connection.pool, {
        ownerId: w.ana,
        cardId: w.cardId,
        categoryId,
        installments: [{ period: '2026-09', amount: 10n }],
      });
    }

    expect((await installmentRows(w, '2026-10', [child])).map((row) => row.categoryId)).toEqual([
      child,
    ]);
  });

  it("never returns another user's installment (AC-16)", async () => {
    const mine = await cardWorld();
    const other = await cardWorld();
    await newInstallmentPurchase(connection.pool, {
      ownerId: other.ana,
      cardId: other.cardId,
      categoryId: other.food,
      installments: [{ period: '2026-09', amount: 9999n }],
    });

    expect(await installmentRows(mine, '2026-10', [mine.food, other.food])).toEqual([]);
    expect((await installmentRows(other)).map((row) => row.sum)).toEqual([9999n]);
  });

  it('answers no rows and issues no statement for an empty category list', async () => {
    const w = await cardWorld();
    const spy = vi.spyOn(connection.pool, 'query');

    const rows = await installmentRows(w, '2026-10', []);
    const issued = spy.mock.calls.length;
    spy.mockRestore();

    expect(rows).toEqual([]);
    expect(issued).toBe(0);
  });

  it('rethrows a database failure instead of swallowing it', async () => {
    const w = await cardWorld();
    const dead = createDatabase(testDatabaseUrl);
    await dead.pool.end();

    await expect(
      new DrizzleSpendingReader(dead.db).installmentSpending(w.scope, windowOf('2026-10'), [
        w.food,
      ]),
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
