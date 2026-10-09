import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleCreditCardRepository } from '../../src/credit-cards/infrastructure/db/drizzle-credit-card-repository';
import { createCardPurchases } from '../../src/movements';
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
} from '../movements/db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

async function newCard(ownerId: string) {
  const { card } = await new DrizzleCreditCardRepository(connection.db).create(
    await writeScope(ownerId),
    {
      name: 'Visa',
      closingDay: 24,
      dueDay: 5,
      firstStatement: { period: '2026-10', closingDate: '2026-10-24', dueDate: '2026-11-05' },
    },
  );
  return card;
}

async function insert(
  fixture: {
    ownerId: string;
    accountId: string;
    categoryId: string;
    type: 'expense' | 'income';
    amount: bigint;
  },
  occurredAt: string,
): Promise<void> {
  await connection.pool.query(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
     values ($1, $2, $3, $4, $5, $6, 14000000, 'manual')`,
    [
      fixture.ownerId,
      fixture.type,
      fixture.accountId,
      fixture.categoryId,
      fixture.amount.toString(),
      occurredAt,
    ],
  );
}

describe('createCardPurchases.dailyPurchases', () => {
  it('groups expenses by local day in the given time zone and sums per currency (AC-02, AC-03)', async () => {
    const ownerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const categoryId = await newCategory(connection.pool, ownerId, 'expense');
    const base = { ownerId, categoryId, type: 'expense' as const };
    await insert({ ...base, accountId: card.arsAccountId, amount: 100n }, '2026-10-25T02:00:00Z');
    await insert({ ...base, accountId: card.arsAccountId, amount: 50n }, '2026-10-25T02:30:00Z');
    await insert({ ...base, accountId: card.arsAccountId, amount: 7n }, '2026-10-25T03:00:00Z');
    await insert({ ...base, accountId: card.usdAccountId, amount: 9n }, '2026-10-25T03:00:00Z');

    const result = await createCardPurchases(connection.db).dailyPurchases(
      await readScope(ownerId),
      card,
      BUENOS_AIRES,
    );

    const sorted = [...result].sort((a, b) =>
      `${a.day}${a.currency}`.localeCompare(`${b.day}${b.currency}`),
    );
    expect(sorted).toEqual([
      { day: '2026-10-24', currency: 'ARS', amount: 150n },
      { day: '2026-10-25', currency: 'ARS', amount: 7n },
      { day: '2026-10-25', currency: 'USD', amount: 9n },
    ]);
  });

  it('uses the time zone it is given and never puts it in the statement', async () => {
    const ownerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const categoryId = await newCategory(connection.pool, ownerId, 'expense');
    await insert(
      { ownerId, categoryId, type: 'expense', accountId: card.arsAccountId, amount: 5n },
      '2026-10-25T02:00:00Z',
    );
    const purchases = createCardPurchases(connection.db);

    expect(await purchases.dailyPurchases(await readScope(ownerId), card, 'UTC')).toEqual([
      { day: '2026-10-25', currency: 'ARS', amount: 5n },
    ]);
    // A hostile name is never part of a statement: it falls back to the default zone.
    expect(
      await purchases.dailyPurchases(
        await readScope(ownerId),
        card,
        "UTC'; drop table movements;--",
      ),
    ).toEqual([{ day: '2026-10-24', currency: 'ARS', amount: 5n }]);
    const stored = await connection.pool.query<{ n: string }>(
      'select count(*) as n from movements where owner_id = $1',
      [ownerId],
    );
    expect(Number(stored.rows[0]?.n)).toBe(1);
  });

  it('does not sum income, transfers, exchanges or expenses on other accounts (FR-03)', async () => {
    const ownerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const categoryId = await newCategory(connection.pool, ownerId, 'expense');
    const incomeCategory = await newCategory(connection.pool, ownerId, 'income');
    const other = await newAccount(connection.pool, ownerId);
    const otherUsd = await newAccount(connection.pool, ownerId, false, 'USD');
    const when = '2026-10-20T15:00:00Z';
    await insert(
      { ownerId, categoryId, type: 'expense', accountId: card.arsAccountId, amount: 11n },
      when,
    );
    await insert(
      {
        ownerId,
        categoryId: incomeCategory,
        type: 'income',
        accountId: card.arsAccountId,
        amount: 1000n,
      },
      when,
    );
    await newTransfer(connection.pool, {
      ownerId,
      accountId: card.arsAccountId,
      destinationAccountId: other,
      amount: 500n,
    });
    await newExchange(connection.pool, {
      ownerId,
      accountId: card.arsAccountId,
      destinationAccountId: otherUsd,
      amount: 700n,
      destinationAmount: 1n,
      rate: 14000000n,
    });
    await insert({ ownerId, categoryId, type: 'expense', accountId: other, amount: 99n }, when);

    const result = await createCardPurchases(connection.db).dailyPurchases(
      await readScope(ownerId),
      card,
      BUENOS_AIRES,
    );

    expect(result).toEqual([{ day: '2026-10-20', currency: 'ARS', amount: 11n }]);
  });

  it("finds nothing under another user's scope (sad path)", async () => {
    const ownerId = await newUserId(connection.db);
    const strangerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const categoryId = await newCategory(connection.pool, ownerId, 'expense');
    await insert(
      { ownerId, categoryId, type: 'expense', accountId: card.arsAccountId, amount: 11n },
      '2026-10-20T15:00:00Z',
    );

    expect(
      await createCardPurchases(connection.db).dailyPurchases(
        await readScope(strangerId),
        card,
        BUENOS_AIRES,
      ),
    ).toEqual([]);
  });

  it('sums amounts above 2^53 exactly (NFR-01)', async () => {
    const ownerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const categoryId = await newCategory(connection.pool, ownerId, 'expense');
    const when = '2026-10-20T15:00:00Z';
    // A movement is capped at 10^15, so ten near-cap rows and a unit push the sum past 2^53 on an odd value.
    const amounts = [...Array.from({ length: 10 }, () => 999_999_999_999_999n), 1n];
    for (const amount of amounts) {
      await insert(
        { ownerId, categoryId, type: 'expense', accountId: card.arsAccountId, amount },
        when,
      );
    }
    const expected = 9_999_999_999_999_991n;
    expect(expected > 2n ** 53n).toBe(true);

    expect(
      await createCardPurchases(connection.db).dailyPurchases(
        await readScope(ownerId),
        card,
        BUENOS_AIRES,
      ),
    ).toEqual([{ day: '2026-10-20', currency: 'ARS', amount: expected }]);
  });
});

describe('createCardPurchases.dailyPurchases without the database tz names', () => {
  async function seeded() {
    const ownerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const categoryId = await newCategory(connection.pool, ownerId, 'expense');
    const base = { ownerId, categoryId, type: 'expense' as const };
    // 2026-10-24T18:30Z is 2026-10-25 00:00 in UTC+5:30 and 2026-10-24 15:30 in Buenos Aires.
    await insert({ ...base, accountId: card.arsAccountId, amount: 10n }, '2026-10-24T18:29:59Z');
    await insert({ ...base, accountId: card.arsAccountId, amount: 20n }, '2026-10-24T18:30:00Z');
    await insert({ ...base, accountId: card.arsAccountId, amount: 5n }, '2026-10-24T18:45:00Z');
    return { card, scope: await readScope(ownerId) };
  }

  it('splits the day at a half-hour offset exactly (Asia/Kolkata)', async () => {
    const { card, scope } = await seeded();

    const result = await createCardPurchases(connection.db).dailyPurchases(
      scope,
      card,
      'Asia/Kolkata',
    );

    expect(result).toEqual(
      expect.arrayContaining([
        { day: '2026-10-24', currency: 'ARS', amount: 10n },
        { day: '2026-10-25', currency: 'ARS', amount: 25n },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('answers for the legacy alias the browsers report (America/Buenos_Aires)', async () => {
    const { card, scope } = await seeded();

    const result = await createCardPurchases(connection.db).dailyPurchases(
      scope,
      card,
      'America/Buenos_Aires',
    );

    expect(result).toEqual([{ day: '2026-10-24', currency: 'ARS', amount: 35n }]);
  });

  it('never sends the zone name to the database: a name it cannot decode does not fail (22023)', async () => {
    const { card, scope } = await seeded();

    const result = await createCardPurchases(connection.db).dailyPurchases(
      scope,
      card,
      'Not/A_Zone',
    );

    expect(result).toEqual([{ day: '2026-10-24', currency: 'ARS', amount: 35n }]);
  });
});
