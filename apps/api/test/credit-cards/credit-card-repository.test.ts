import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountLinkedToCard, DeleteAccount } from '../../src/accounts';
import { DrizzleAccountRepository } from '../../src/accounts/infrastructure/db/drizzle-account-repository';
import { ResourceNotFound } from '../../src/shared/access';
import { CardAccountNameTaken, CardHasMovements } from '../../src/credit-cards/domain/errors';
import { DrizzleDebitAccounts } from '../../src/credit-cards/infrastructure/db/drizzle-debit-accounts';
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

const NO_LINKS = { ARS: null, USD: null };

describe('DrizzleCreditCardRepository.updateDebitAccounts', () => {
  it('saves a debit account per currency and reads both back through findById and list (AC-01)', async () => {
    const ownerId = await newUserId(connection.db);
    const { card } = await createVisa(ownerId);
    const ars = await newAccount(connection.pool, ownerId, false, 'ARS');
    const usd = await newAccount(connection.pool, ownerId, false, 'USD');
    const links = {
      ARS: { accountId: ars, linkedOn: '2026-10-01' },
      USD: { accountId: usd, linkedOn: '2026-10-02' },
    };

    const saved = await repository.updateDebitAccounts(await writeScope(ownerId), card.id, links);

    expect(saved?.debitAccounts).toEqual(links);
    expect((await repository.findById(await readScope(ownerId), card.id))?.debitAccounts).toEqual(
      links,
    );
    expect((await repository.list(await readScope(ownerId)))[0]?.debitAccounts).toEqual(links);
  });

  it('starts with no debit accounts on a new card', async () => {
    const ownerId = await newUserId(connection.db);
    const { card } = await createVisa(ownerId);

    expect(card.debitAccounts).toEqual(NO_LINKS);
  });

  it('clears an account and its date together in one statement (AC-04)', async () => {
    const ownerId = await newUserId(connection.db);
    const { card } = await createVisa(ownerId);
    const scope = await writeScope(ownerId);
    const ars = await newAccount(connection.pool, ownerId, false, 'ARS');
    const usd = await newAccount(connection.pool, ownerId, false, 'USD');
    await repository.updateDebitAccounts(scope, card.id, {
      ARS: { accountId: ars, linkedOn: '2026-10-01' },
      USD: { accountId: usd, linkedOn: '2026-10-01' },
    });

    const cleared = await repository.updateDebitAccounts(scope, card.id, {
      ARS: null,
      USD: { accountId: usd, linkedOn: '2026-10-01' },
    });

    expect(cleared?.debitAccounts).toEqual({
      ARS: null,
      USD: { accountId: usd, linkedOn: '2026-10-01' },
    });
    const row = await connection.pool.query(
      'select debit_ars_account_id, debit_ars_linked_on from credit_cards where id = $1',
      [card.id],
    );
    expect(row.rows[0]).toEqual({ debit_ars_account_id: null, debit_ars_linked_on: null });
  });

  it("updates nothing and answers null under another owner's scope (sad path, AC-05)", async () => {
    const ana = await newUserId(connection.db);
    const bob = await newUserId(connection.db);
    const { card } = await createVisa(ana);
    const bobAccount = await newAccount(connection.pool, bob, false, 'ARS');

    const result = await repository.updateDebitAccounts(await writeScope(bob), card.id, {
      ARS: { accountId: bobAccount, linkedOn: '2026-10-01' },
      USD: null,
    });

    expect(result).toBeNull();
    expect((await repository.findById(await readScope(ana), card.id))?.debitAccounts).toEqual(
      NO_LINKS,
    );
  });

  it('turns the key violation of a missing or foreign account into ResourceNotFound (sad path, AC-05)', async () => {
    const ana = await newUserId(connection.db);
    const bob = await newUserId(connection.db);
    const { card } = await createVisa(ana);
    const scope = await writeScope(ana);
    const deleted = await newAccount(connection.pool, ana, false, 'ARS');
    await connection.pool.query('delete from accounts where id = $1', [deleted]);
    const foreign = await newAccount(connection.pool, bob, false, 'USD');

    await expect(
      repository.updateDebitAccounts(scope, card.id, {
        ARS: { accountId: deleted, linkedOn: '2026-10-01' },
        USD: null,
      }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(
      repository.updateDebitAccounts(scope, card.id, {
        ARS: null,
        USD: { accountId: foreign, linkedOn: '2026-10-01' },
      }),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect((await repository.findById(await readScope(ana), card.id))?.debitAccounts).toEqual(
      NO_LINKS,
    );
  });
});

describe('DrizzleCreditCardRepository.isCardAccount', () => {
  it("is true for a linked account of any of the owner's cards, false otherwise (AC-05)", async () => {
    const ana = await newUserId(connection.db);
    const bob = await newUserId(connection.db);
    const first = (await createVisa(ana, 'Visa')).card;
    const second = (await createVisa(ana, 'Amex')).card;
    const bank = await newAccount(connection.pool, ana);
    const scope = await readScope(ana);

    expect(await repository.isCardAccount(scope, first.arsAccountId)).toBe(true);
    expect(await repository.isCardAccount(scope, second.usdAccountId)).toBe(true);
    expect(await repository.isCardAccount(scope, bank)).toBe(false);
    expect(await repository.isCardAccount(await readScope(bob), first.arsAccountId)).toBe(false);
  });
});

describe('DrizzleDebitAccounts', () => {
  it('reads currency and archive state of an own account and null for a foreign or missing one', async () => {
    const ana = await newUserId(connection.db);
    const bob = await newUserId(connection.db);
    const open = await newAccount(connection.pool, ana, false, 'USD');
    const archived = await newAccount(connection.pool, ana, true, 'ARS');
    const debitAccounts = new DrizzleDebitAccounts(connection.db);
    const scope = await readScope(ana);

    expect(await debitAccounts.find(scope, open)).toEqual({ currency: 'USD', archived: false });
    expect(await debitAccounts.find(scope, archived)).toEqual({ currency: 'ARS', archived: true });
    expect(await debitAccounts.find(await readScope(bob), open)).toBeNull();
    expect(await debitAccounts.find(scope, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});

describe('DrizzleCardAccountLinks with a debit account', () => {
  it('is linked while used as debit account and free once the link is cleared (FR-01)', async () => {
    const ownerId = await newUserId(connection.db);
    const { card } = await createVisa(ownerId);
    const scope = await writeScope(ownerId);
    const bank = await newAccount(connection.pool, ownerId, false, 'USD');
    const links = new DrizzleCardAccountLinks(connection.db);

    expect(await links.isLinked(bank)).toBe(false);
    await repository.updateDebitAccounts(scope, card.id, {
      ARS: null,
      USD: { accountId: bank, linkedOn: '2026-10-01' },
    });
    expect(await links.isLinked(bank)).toBe(true);
    await repository.updateDebitAccounts(scope, card.id, NO_LINKS);
    expect(await links.isLinked(bank)).toBe(false);
  });

  it('refuses to delete a debit account but allows archiving it (sad path, FR-04)', async () => {
    const ownerId = await newUserId(connection.db);
    const { card } = await createVisa(ownerId);
    const scope = await writeScope(ownerId);
    const bank = await newAccount(connection.pool, ownerId, false, 'ARS');
    await repository.updateDebitAccounts(scope, card.id, {
      ARS: { accountId: bank, linkedOn: '2026-10-01' },
      USD: null,
    });
    const accounts = new DrizzleAccountRepository(connection.db);
    const deleteAccount = new DeleteAccount({
      accounts,
      movements: {
        hasMovements: () => Promise.resolve(false),
        sumsByAccount: () => Promise.resolve(new Map<string, bigint>()),
      },
      links: new DrizzleCardAccountLinks(connection.db),
    });

    await expect(deleteAccount.execute(scope, bank)).rejects.toBeInstanceOf(AccountLinkedToCard);
    // The restricting key also answers when the use case's check is bypassed.
    await expect(accounts.delete(scope, bank)).rejects.toBeInstanceOf(AccountLinkedToCard);
    expect(await accounts.findById(scope, bank)).not.toBeNull();

    const archived = await accounts.setArchived(scope, bank, true);
    expect(archived?.archivedAt).not.toBeNull();
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
