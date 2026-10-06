import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CardAccountNameTaken, CardHasMovements } from '../../src/credit-cards/domain/errors';
import { DrizzleCardAccountLinks } from '../../src/credit-cards/infrastructure/db/drizzle-card-account-links';
import { DrizzleCreditCardRepository } from '../../src/credit-cards/infrastructure/db/drizzle-credit-card-repository';
import { DrizzleUserTimeZone } from '../../src/credit-cards/infrastructure/db/drizzle-user-time-zone';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  newAccount,
  newCategory,
  newMovement,
  newUserId,
  readScope,
  writeScope,
} from '../movements/db-fixtures';

let connection: DatabaseConnection;
let repository: DrizzleCreditCardRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleCreditCardRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const OCTOBER = { period: '2026-10', closingDate: '2026-10-24', dueDate: '2026-11-05' };

async function createVisa(ownerId: string, name = 'Visa') {
  return repository.create(await writeScope(ownerId), {
    name,
    closingDay: 24,
    dueDay: 5,
    firstStatement: OCTOBER,
  });
}

async function accountRows(ownerId: string) {
  const result = await connection.pool.query<{
    id: string;
    name: string;
    type: string;
    currency: string;
    opening_balance: string;
    include_in_available: boolean;
  }>(
    'select id, name, type, currency, opening_balance, include_in_available from accounts where owner_id = $1 order by name',
    [ownerId],
  );
  return result.rows;
}

const count = async (statement: string, params: unknown[]): Promise<number> => {
  const result = await connection.pool.query<{ n: string }>(statement, params);
  return Number(result.rows[0]?.n);
};

describe('DrizzleCreditCardRepository.create', () => {
  it('stores the card, both linked credit card accounts and the first statement (AC-01, AC-03)', async () => {
    const ownerId = await newUserId(connection.db);
    const { card, statement } = await createVisa(ownerId);

    expect(card).toMatchObject({ name: 'Visa', closingDay: 24, dueDay: 5 });
    expect(statement).toMatchObject({ cardId: card.id, ...OCTOBER });
    expect(await accountRows(ownerId)).toEqual([
      {
        id: card.arsAccountId,
        name: 'Visa ARS',
        type: 'credit_card',
        currency: 'ARS',
        opening_balance: '0',
        include_in_available: false,
      },
      {
        id: card.usdAccountId,
        name: 'Visa USD',
        type: 'credit_card',
        currency: 'USD',
        opening_balance: '0',
        include_in_available: false,
      },
    ]);
  });

  it('refuses a card when "Visa USD" exists in any case and stores nothing (sad path, FR-02)', async () => {
    const ownerId = await newUserId(connection.db);
    await connection.pool.query(
      "insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available) values ($1, 'visa usd', 'cash', 'USD', 0, true)",
      [ownerId],
    );

    await expect(createVisa(ownerId)).rejects.toBeInstanceOf(CardAccountNameTaken);
    expect(
      await count('select count(*) as n from credit_cards where owner_id = $1', [ownerId]),
    ).toBe(0);
    expect((await accountRows(ownerId)).map((row) => row.name)).toEqual(['visa usd']);
  });
});

describe('DrizzleCreditCardRepository reads and writes', () => {
  it("lists only the owner's cards, oldest first (AC-11)", async () => {
    const ana = await newUserId(connection.db);
    const bob = await newUserId(connection.db);
    await createVisa(ana, 'Visa');
    await createVisa(ana, 'Amex');
    await createVisa(bob, 'Master');

    expect((await repository.list(await readScope(ana))).map((card) => card.name)).toEqual([
      'Visa',
      'Amex',
    ]);
  });

  it("finds, lists, updates and deletes nothing of another user's card (sad path, AC-10)", async () => {
    const ana = await newUserId(connection.db);
    const bob = await newUserId(connection.db);
    const { card, statement } = await createVisa(ana);
    const bobWrite = await writeScope(bob);

    expect(await repository.findById(await readScope(bob), card.id)).toBeNull();
    expect(await repository.listStatements(await readScope(bob), card.id)).toEqual([]);
    expect(
      await repository.updateStatement(bobWrite, card.id, statement.id, {
        closingDate: '2026-10-26',
        dueDate: '2026-11-05',
      }),
    ).toBeNull();
    expect(
      await repository.updateDays(bobWrite, card.id, { closingDay: 20, dueDay: 5 }, [
        { ...statement, closingDate: '2026-10-20' },
      ]),
    ).toBeNull();
    await repository.insertStatements(bobWrite, card.id, [
      { period: '2026-11', closingDate: '2026-11-24', dueDate: '2026-12-05' },
    ]);
    expect(await repository.delete(bobWrite, card)).toBe(false);

    expect(await repository.listStatements(await readScope(ana), card.id)).toEqual([statement]);
    expect((await repository.findById(await readScope(ana), card.id))?.closingDay).toBe(24);
  });

  it('keeps one row when the same period is inserted twice (FR-03)', async () => {
    const ownerId = await newUserId(connection.db);
    const { card } = await createVisa(ownerId);
    const scope = await writeScope(ownerId);
    const november = { period: '2026-11', closingDate: '2026-11-24', dueDate: '2026-12-05' };

    await repository.insertStatements(scope, card.id, [november, OCTOBER]);
    await repository.insertStatements(scope, card.id, [november]);

    expect(
      (await repository.listStatements(scope, card.id)).map((statement) => statement.period),
    ).toEqual(['2026-10', '2026-11']);
  });

  it('saves the days with the recomputed statements and edits one statement (FR-05, FR-06)', async () => {
    const ownerId = await newUserId(connection.db);
    const { card, statement } = await createVisa(ownerId);
    const scope = await writeScope(ownerId);

    const updated = await repository.updateDays(scope, card.id, { closingDay: 20, dueDay: 5 }, [
      { ...statement, closingDate: '2026-10-20' },
    ]);
    expect(updated?.closingDay).toBe(20);
    expect(
      await repository.updateStatement(scope, card.id, statement.id, {
        closingDate: '2026-10-22',
        dueDate: '2026-11-06',
      }),
    ).toMatchObject({ closingDate: '2026-10-22', dueDate: '2026-11-06' });
    expect(
      await repository.updateStatement(scope, card.id, '00000000-0000-4000-8000-000000000000', {
        closingDate: '2026-10-22',
        dueDate: '2026-11-06',
      }),
    ).toBeNull();
  });
});

describe('DrizzleCreditCardRepository.delete', () => {
  it('removes the card, its statements and both accounts (FR-08)', async () => {
    const ownerId = await newUserId(connection.db);
    const { card } = await createVisa(ownerId);

    expect(await repository.delete(await writeScope(ownerId), card)).toBe(true);

    expect(
      await count('select count(*) as n from credit_cards where owner_id = $1', [ownerId]),
    ).toBe(0);
    expect(
      await count('select count(*) as n from credit_card_statements where owner_id = $1', [
        ownerId,
      ]),
    ).toBe(0);
    expect(await accountRows(ownerId)).toEqual([]);
  });

  it('fails with CardHasMovements when a linked account has a movement, keeping every row (sad path)', async () => {
    const ownerId = await newUserId(connection.db);
    const { card } = await createVisa(ownerId);
    const categoryId = await newCategory(connection.pool, ownerId, 'expense');
    await newMovement(connection.pool, {
      ownerId,
      accountId: card.usdAccountId,
      categoryId,
      type: 'expense',
      amount: 100n,
    });

    await expect(repository.delete(await writeScope(ownerId), card)).rejects.toBeInstanceOf(
      CardHasMovements,
    );
    expect(await count('select count(*) as n from credit_cards where id = $1', [card.id])).toBe(1);
    expect(await accountRows(ownerId)).toHaveLength(2);
  });
});

describe('DrizzleCardAccountLinks', () => {
  it('reports both linked accounts and no other credit card account', async () => {
    const ownerId = await newUserId(connection.db);
    const { card } = await createVisa(ownerId);
    const other = await newAccount(connection.pool, ownerId);
    const links = new DrizzleCardAccountLinks(connection.db);

    expect(await links.isLinked(card.arsAccountId)).toBe(true);
    expect(await links.isLinked(card.usdAccountId)).toBe(true);
    expect(await links.isLinked(other)).toBe(false);
  });
});

describe('DrizzleUserTimeZone', () => {
  it('reads the stored zone and falls back to Buenos Aires for an invalid one', async () => {
    const zones = new DrizzleUserTimeZone(connection.db);
    const madrid = await newUserId(connection.db, { timeZone: 'Europe/Madrid' });
    const broken = await newUserId(connection.db, { timeZone: 'Not/AZone' });

    expect(await zones.timeZoneOf(madrid)).toBe('Europe/Madrid');
    expect(await zones.timeZoneOf(broken)).toBe('America/Argentina/Buenos_Aires');
  });

  it('fails closed for a user that does not exist (error path)', async () => {
    await expect(
      new DrizzleUserTimeZone(connection.db).timeZoneOf('00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow();
  });
});
