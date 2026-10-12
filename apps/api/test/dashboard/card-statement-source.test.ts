import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DrizzleCreditCardRepository } from '../../src/credit-cards';
import { DrizzleCardStatementSource } from '../../src/dashboard/infrastructure/credit-cards/drizzle-card-statement-source';
import { DrizzleAccountCurrencyReader } from '../../src/dashboard/infrastructure/db/drizzle-account-currency-reader';
import { createCardPayments, createCardPurchases } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import {
  newAccount,
  newCategory,
  newTransfer,
  newUserId,
  readScope,
  writeScope,
} from '../movements/db-fixtures';

let connection: DatabaseConnection;
let source: DrizzleCardStatementSource;
let currencies: DrizzleAccountCurrencyReader;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  source = new DrizzleCardStatementSource({
    db: connection.db,
    purchases: createCardPurchases(connection.db),
    cardPayments: createCardPayments(connection.db),
  });
  currencies = new DrizzleAccountCurrencyReader(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const ZONE = 'America/Argentina/Buenos_Aires';

interface FirstStatement {
  period: string;
  closingDate: string;
  dueDate: string;
}

async function newCard(ownerId: string, name: string, firstStatement: FirstStatement) {
  return new DrizzleCreditCardRepository(connection.db).create(await writeScope(ownerId), {
    name,
    closingDay: 24,
    dueDay: 5,
    reminderDays: 3,
    firstStatement,
  });
}

async function purchase(ownerId: string, accountId: string, amount: bigint, at: string) {
  const categoryId = await newCategory(connection.pool, ownerId, 'expense');
  await connection.pool.query(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
     values ($1, 'expense', $2, $3, $4, $5, 14000000, 'manual')`,
    [ownerId, accountId, categoryId, amount.toString(), at],
  );
}

const SEPTEMBER: FirstStatement = {
  period: '2026-09',
  closingDate: '2026-09-24',
  dueDate: '2026-10-08',
};

describe('DrizzleCardStatementSource', () => {
  it('returns the closed owing statement with its owed amounts and leaves a paid one out', async () => {
    const ownerId = await newUserId(connection.db);
    const { card, statement } = await newCard(ownerId, 'Visa', SEPTEMBER);
    await purchase(ownerId, card.arsAccountId, 900n, '2026-09-20T15:00:00Z');
    await purchase(ownerId, card.usdAccountId, 40n, '2026-09-21T15:00:00Z');
    const paid = await newCard(ownerId, 'Master', { ...SEPTEMBER, dueDate: '2026-10-09' });
    await purchase(ownerId, paid.card.arsAccountId, 100n, '2026-09-20T15:00:00Z');
    const bank = await newAccount(connection.pool, ownerId);
    await newTransfer(connection.pool, {
      ownerId,
      accountId: bank,
      destinationAccountId: paid.card.arsAccountId,
      amount: 100n,
    });

    const result = await source.dueStatements(await readScope(ownerId), '2026-10-06', ZONE);

    expect(result).toEqual([
      {
        cardId: card.id,
        cardName: 'Visa',
        statementId: statement.id,
        dueDate: '2026-10-08',
        closed: true,
        owed: { ARS: 900n, USD: 40n },
      },
    ]);
  });

  it('returns a closed statement that is only partly paid with what is still owed', async () => {
    const ownerId = await newUserId(connection.db);
    const { card, statement } = await newCard(ownerId, 'Visa', SEPTEMBER);
    await purchase(ownerId, card.arsAccountId, 900n, '2026-09-20T15:00:00Z');
    const bank = await newAccount(connection.pool, ownerId);
    await newTransfer(connection.pool, {
      ownerId,
      accountId: bank,
      destinationAccountId: card.arsAccountId,
      amount: 300n,
    });

    const result = await source.dueStatements(await readScope(ownerId), '2026-10-06', ZONE);

    expect(result).toEqual([
      {
        cardId: card.id,
        cardName: 'Visa',
        statementId: statement.id,
        dueDate: '2026-10-08',
        closed: true,
        owed: { ARS: 600n, USD: 0n },
      },
    ]);
  });

  it("leaves out a statement due after today plus 7 and never shows another user's cards", async () => {
    const ownerId = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const far = await newCard(ownerId, 'Far', {
      period: '2026-10',
      closingDate: '2026-10-24',
      dueDate: '2026-11-05',
    });
    await purchase(ownerId, far.card.arsAccountId, 10n, '2026-10-02T15:00:00Z');
    const theirs = await newCard(other, 'Other', SEPTEMBER);
    await purchase(other, theirs.card.arsAccountId, 10n, '2026-09-20T15:00:00Z');

    expect(await source.dueStatements(await readScope(ownerId), '2026-10-06', ZONE)).toEqual([]);
  });

  it('reads the installment rows once for 3 cards and creates no statement (NFR-05)', async () => {
    const ownerId = await newUserId(connection.db);
    for (const name of ['A', 'B', 'C']) await newCard(ownerId, name, SEPTEMBER);
    const count = () =>
      connection.pool.query<{ n: number }>('select count(*)::int as n from credit_card_statements');
    const before = await count();
    const spy = vi.spyOn(connection.pool, 'query');
    const scope = await readScope(ownerId);

    await source.dueStatements(scope, '2026-10-06', ZONE);

    const texts = spy.mock.calls.map(([query]) =>
      typeof query === 'string' ? query : ((query as { text?: string }).text ?? ''),
    );
    spy.mockRestore();
    expect(texts.filter((text) => text.includes('"installment_purchases"'))).toHaveLength(1);
    expect((await count()).rows).toEqual(before.rows);
  });
});

describe('DrizzleAccountCurrencyReader', () => {
  it("maps the caller's accounts to their currency and skips foreign ids", async () => {
    const ownerId = await newUserId(connection.db);
    const other = await newUserId(connection.db);
    const ars = await newAccount(connection.pool, ownerId, false, 'ARS');
    const usd = await newAccount(connection.pool, ownerId, false, 'USD');
    const foreign = await newAccount(connection.pool, other, false, 'USD');

    const map = await currencies.currenciesOf(await readScope(ownerId), [ars, usd, foreign]);

    expect(map).toEqual(
      new Map([
        [ars, 'ARS'],
        [usd, 'USD'],
      ]),
    );
  });

  it('answers an empty map for no ids', async () => {
    const ownerId = await newUserId(connection.db);

    expect((await currencies.currenciesOf(await readScope(ownerId), [])).size).toBe(0);
  });
});
