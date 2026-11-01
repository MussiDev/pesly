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
  newGroup,
  newGroupCategory,
  newGroupExpense,
  newMember,
  newMovementAt,
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

/** A card closing on the 24th and due on the 5th, with the September and October statements stored. */
async function world(options: { statements?: boolean; closingDay?: number; dueDay?: number } = {}) {
  const ana = await newUserId(connection.db);
  const ars = await newAccount(connection.pool, ana, false, 'ARS');
  const usd = await newAccount(connection.pool, ana, false, 'USD');
  const bank = await newAccount(connection.pool, ana, false, 'ARS');
  const food = await newCategory(connection.pool, ana, 'expense');
  const cardId = await newCard(connection.pool, {
    ownerId: ana,
    arsAccountId: ars,
    usdAccountId: usd,
    closingDay: options.closingDay ?? 24,
    dueDay: options.dueDay ?? 5,
  });
  if (options.statements !== false) {
    await newStatement(connection.pool, {
      cardId,
      ownerId: ana,
      period: '2026-09',
      closingDate: '2026-09-24',
      dueDate: '2026-10-05',
    });
    await newStatement(connection.pool, {
      cardId,
      ownerId: ana,
      period: '2026-10',
      closingDate: '2026-10-24',
      dueDate: '2026-11-05',
    });
  }
  return { ana, scope: await readScope(ana), ars, usd, bank, food, cardId };
}

type World = Awaited<ReturnType<typeof world>>;

const purchase = (
  w: World,
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

const rowsOf = (w: World, from = '2026-08', to = '2026-12', options: object = {}) =>
  reader.cardPurchaseRows(w.scope, from, to, { timeZone: BUENOS_AIRES, ...options });

describe('DrizzleFlowReader.cardPurchaseRows', () => {
  it('returns the stored statement and due date of a September purchase, due in October (AC-01, AC-03)', async () => {
    const w = await world();
    await purchase(w, { amount: 3000000n, occurredAt: '2026-09-20T15:00:00Z' });

    const rows = await rowsOf(w);

    expect(rows).toEqual([
      {
        cardId: w.cardId,
        period: '2026-09',
        dueDate: '2026-10-05',
        closingDay: 24,
        dueDay: 5,
        topCategoryId: w.food,
        currency: 'ARS',
        rate: 14000000n,
        sum: 3000000n,
        count: 1,
      },
    ]);
  });

  it('puts a purchase dated after the closing date in the next statement (AC-03)', async () => {
    const w = await world();
    await purchase(w, { amount: 100n, occurredAt: '2026-09-25T15:00:00Z' });

    const rows = await rowsOf(w);

    expect(rows.map((row) => [row.period, row.dueDate])).toEqual([['2026-10', '2026-11-05']]);
  });

  it('puts a purchase made on the closing day itself in that statement, by the local day (AC-03)', async () => {
    const w = await world();
    // 23:30 in Buenos Aires on the 24th is already the 25th in UTC.
    await purchase(w, { amount: 100n, occurredAt: '2026-09-25T02:30:00Z' });

    const rows = await rowsOf(w);

    expect(rows.map((row) => row.period)).toEqual(['2026-09']);
  });

  it('returns the edited due date of a statement whose dates were changed by hand (AC-04)', async () => {
    const w = await world({ statements: false });
    await newStatement(connection.pool, {
      cardId: w.cardId,
      ownerId: w.ana,
      period: '2026-09',
      closingDate: '2026-09-24',
      dueDate: '2026-10-12',
    });
    await purchase(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });

    const [row] = await rowsOf(w);

    expect(row?.dueDate).toBe('2026-10-12');
  });

  it('returns a null due date, the fallback period and the card days when no statement closes after the day (AC-05)', async () => {
    const w = await world({ statements: false });
    await purchase(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });
    await purchase(w, { amount: 10n, occurredAt: '2026-09-25T15:00:00Z' });

    const rows = await rowsOf(w);

    expect(rows.map((row) => [row.period, row.dueDate, row.closingDay, row.dueDay])).toEqual([
      ['2026-09', null, 24, 5],
      ['2026-10', null, 24, 5],
    ]);
  });

  it('still returns the row, with the fallback, for a card whose short-month days need clamping, and does not fail (AC-14)', async () => {
    const w = await world({ statements: false, closingDay: 31, dueDay: 31 });
    await purchase(w, { amount: 100n, occurredAt: '2026-02-20T15:00:00Z' });

    const rows = await rowsOf(w, '2026-01', '2026-04');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.dueDate).toBeNull();
  });

  it('returns only the statements whose period is inside the requested range', async () => {
    const w = await world();
    await purchase(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });

    expect(await rowsOf(w, '2026-10', '2026-12')).toEqual([]);
    expect((await rowsOf(w, '2026-09', '2026-09')).map((row) => row.period)).toEqual(['2026-09']);
  });

  it('does not return an expense on a bank account, which personalRows keeps in its own month (AC-07)', async () => {
    const w = await world();
    await purchase(w, { amount: 800000n, occurredAt: '2026-09-20T15:00:00Z', accountId: w.bank });

    expect(await rowsOf(w)).toEqual([]);
    const personal = await reader.personalRows(w.scope, WIDE);
    expect(personal.map((row) => [row.month, row.sum])).toEqual([['2026-09', 800000n]]);
  });

  it('returns a card-account expense from cardPurchaseRows and never from personalRows, so the two add it once (AC-08)', async () => {
    const w = await world();
    await purchase(w, { amount: 3000000n, occurredAt: '2026-09-20T15:00:00Z' });
    await purchase(w, { amount: 500n, occurredAt: '2026-09-21T15:00:00Z', accountId: w.usd });

    const card = await rowsOf(w);
    const personal = await reader.personalRows(w.scope, WIDE);

    expect(personal).toEqual([]);
    expect(card.map((row) => [row.currency, row.sum]).sort()).toEqual([
      ['ARS', 3000000n],
      ['USD', 500n],
    ]);
  });

  it('keeps an income on a card account in personalRows and out of the card purchases', async () => {
    const w = await world();
    const salary = await newCategory(connection.pool, w.ana, 'income');
    await newMovementAt(connection.pool, {
      ownerId: w.ana,
      accountId: w.ars,
      categoryId: salary,
      amount: 7000n,
      occurredAt: '2026-09-20T15:00:00Z',
      type: 'income',
    });

    expect(await rowsOf(w)).toEqual([]);
    const personal = await reader.personalRows(w.scope, WIDE);
    expect(personal.map((row) => [row.type, row.sum])).toEqual([['income', 7000n]]);
  });

  it('returns neither a transfer nor an exchange into the card account, in either method (AC-09)', async () => {
    const w = await world();
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

    expect(await rowsOf(w)).toEqual([]);
    expect(await reader.personalRows(w.scope, WIDE)).toEqual([]);
  });

  it('carries the movement frozen rate and groups by it (AC-10)', async () => {
    const w = await world();
    await purchase(w, {
      amount: 2000n,
      occurredAt: '2026-09-20T15:00:00Z',
      accountId: w.usd,
      rate: 12000000n,
    });
    await purchase(w, {
      amount: 1000n,
      occurredAt: '2026-09-21T15:00:00Z',
      accountId: w.usd,
      rate: 13000000n,
    });

    const rows = await rowsOf(w);

    expect(rows.map((row) => [row.rate, row.sum]).sort()).toEqual([
      [12000000n, 2000n],
      [13000000n, 1000n],
    ]);
  });

  it('narrows the card rows by the account filter and by the tag filter (AC-11)', async () => {
    const w = await world();
    const tagged = await purchase(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });
    await purchase(w, { amount: 20n, occurredAt: '2026-09-21T15:00:00Z' });
    await purchase(w, { amount: 3n, occurredAt: '2026-09-22T15:00:00Z', accountId: w.usd });
    const tag = await newTag(connection.pool, w.ana, 'Viaje');
    await linkTag(connection.pool, { movementId: tagged, tagId: tag, ownerId: w.ana, position: 0 });

    const byAccount = await rowsOf(w, '2026-08', '2026-12', { accountId: w.usd });
    const byTag = await rowsOf(w, '2026-08', '2026-12', { tag: 'viaje' });

    expect(byAccount.map((row) => [row.currency, row.sum])).toEqual([['USD', 3n]]);
    expect(byTag.map((row) => [row.currency, row.sum])).toEqual([['ARS', 100n]]);
  });

  it('treats a tag with a quote and SQL text as plain text and returns no rows (threat R-02)', async () => {
    const w = await world();
    await purchase(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });

    const rows = await rowsOf(w, '2026-08', '2026-12', { tag: "x' or '1'='1" });

    expect(rows).toEqual([]);
  });

  it('does not return the card purchases of another user (AC-16)', async () => {
    const mine = await world();
    const other = await world();
    await purchase(other, { amount: 9999n, occurredAt: '2026-09-20T15:00:00Z' });

    expect(await rowsOf(mine)).toEqual([]);
    expect((await rowsOf(other)).map((row) => row.sum)).toEqual([9999n]);
  });

  it('reads a purchase stored before this change under the new rule, with no migration step (AC-12)', async () => {
    const w = await world();
    await purchase(w, { amount: 3000000n, occurredAt: '2026-09-20T15:00:00Z' });

    // Nothing is written between the insert and the read: the month is computed on read.
    const rows = await rowsOf(w);

    expect(rows.map((row) => row.dueDate)).toEqual(['2026-10-05']);
  });

  it('returns a purchase far older than the requested period when it belongs to the first stored statement, whatever the range (AC-01, AC-03)', async () => {
    const w = await world({ statements: false });
    await newStatement(connection.pool, {
      cardId: w.cardId,
      ownerId: w.ana,
      period: '2026-10',
      closingDate: '2026-10-24',
      dueDate: '2026-11-05',
    });
    // Dated in March, before every stored cycle: it belongs to the first stored statement.
    await purchase(w, { amount: 100n, occurredAt: '2026-03-10T15:00:00Z' });

    const narrow = await rowsOf(w, '2026-10', '2026-10');
    const wide = await rowsOf(w, '2026-03', '2026-12');

    expect(narrow.map((row) => [row.period, row.dueDate, row.sum])).toEqual([
      ['2026-10', '2026-11-05', 100n],
    ]);
    expect(wide).toEqual(narrow);
  });

  it('puts a purchase dated after an edited closing date in the cycle after the last stored statement, not in a stored one (AC-05)', async () => {
    const w = await world({ statements: false });
    // The October statement was moved by hand to close on the 8th, and no later one is stored.
    await newStatement(connection.pool, {
      cardId: w.cardId,
      ownerId: w.ana,
      period: '2026-10',
      closingDate: '2026-10-08',
      dueDate: '2026-11-05',
    });
    await purchase(w, { amount: 100n, occurredAt: '2026-10-10T15:00:00Z' });

    const rows = await rowsOf(w, '2026-09', '2026-12');

    expect(rows.map((row) => [row.period, row.dueDate])).toEqual([['2026-11', null]]);
  });

  it('leaves out the payer movement of a group expense, whose share counts instead', async () => {
    const w = await world();
    const payerMovement = await purchase(w, {
      amount: 4000000n,
      occurredAt: '2026-09-20T15:00:00Z',
    });
    await purchase(w, { amount: 100n, occurredAt: '2026-09-21T15:00:00Z' });
    const group = await newGroup(connection.pool);
    const me = await newMember(connection.pool, group, w.ana);
    await newGroupExpense(connection.pool, {
      groupId: group,
      payerMemberId: me,
      categoryId: await newGroupCategory(connection.pool, group, { name: 'food' }),
      amount: 4000000n,
      occurredAt: '2026-09-20T15:00:00Z',
      payerMovementId: payerMovement,
      shares: [{ memberId: me, amount: 4000000n }],
    });

    const rows = await rowsOf(w);

    expect(rows.map((row) => row.sum)).toEqual([100n]);
  });

  it('cannot be fed a card purchase without a frozen rate: the database rejects it with an error', async () => {
    const w = await world();
    const id = await purchase(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });

    await expect(
      connection.pool.query('update movements set rate = null, rate_source = null where id = $1', [
        id,
      ]),
    ).rejects.toThrow('movements_shape_check');
  });

  it('cannot be fed a card purchase without a category: the database rejects it with an error', async () => {
    const w = await world();
    const id = await purchase(w, { amount: 100n, occurredAt: '2026-09-20T15:00:00Z' });

    await expect(
      connection.pool.query('update movements set category_id = null where id = $1', [id]),
    ).rejects.toThrow('movements_shape_check');
  });
});
