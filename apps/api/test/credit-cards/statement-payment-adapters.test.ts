import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleCreditCardRepository } from '../../src/credit-cards/infrastructure/db/drizzle-credit-card-repository';
import { createCardPayments, createStatementPaymentRecorder } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
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

const silent = createLogger({ level: 'error', destination: { write: () => undefined } });

describe('createCardPayments.receivedByCard', () => {
  it('adds up the transfers received by each linked account and ignores the rest (D2)', async () => {
    const ownerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const bank = await newAccount(connection.pool, ownerId);
    const usdBank = await newAccount(connection.pool, ownerId, false, 'USD');
    const categoryId = await newCategory(connection.pool, ownerId, 'expense');
    const base = { ownerId, accountId: bank };
    await newTransfer(connection.pool, {
      ...base,
      destinationAccountId: card.arsAccountId,
      amount: 6_000_000n,
    });
    await newTransfer(connection.pool, {
      ...base,
      destinationAccountId: card.arsAccountId,
      amount: 500n,
    });
    await newTransfer(connection.pool, {
      ownerId,
      accountId: usdBank,
      destinationAccountId: card.usdAccountId,
      amount: 2_000n,
    });
    // An outgoing transfer of the card and an expense on it are not payments; an exchange into its USD account is.
    await newTransfer(connection.pool, {
      ownerId,
      accountId: card.arsAccountId,
      destinationAccountId: bank,
      amount: 9_999n,
    });
    await connection.pool.query(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
       values ($1, 'expense', $2, $3, 777, now(), 14000000, 'manual')`,
      [ownerId, card.arsAccountId, categoryId],
    );
    await newExchange(connection.pool, {
      ownerId,
      accountId: bank,
      destinationAccountId: card.usdAccountId,
      amount: 140_000n,
      destinationAmount: 10n,
      rate: 140_000_000n,
    });

    const received = await createCardPayments(connection.db).receivedByCard(
      await readScope(ownerId),
      card,
    );

    expect(received).toEqual({ ARS: 6_000_500n, USD: 2_010n });
  });

  it('ignores an exchange out of the card USD account and one into its ARS account (D2)', async () => {
    const ownerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const bank = await newAccount(connection.pool, ownerId);
    const usdBank = await newAccount(connection.pool, ownerId, false, 'USD');
    await newExchange(connection.pool, {
      ownerId,
      accountId: card.usdAccountId,
      destinationAccountId: bank,
      amount: 10n,
      destinationAmount: 140_000n,
      rate: 140_000_000n,
    });
    await newExchange(connection.pool, {
      ownerId,
      accountId: usdBank,
      destinationAccountId: card.arsAccountId,
      amount: 10n,
      destinationAmount: 140_000n,
      rate: 140_000_000n,
    });

    const received = await createCardPayments(connection.db).receivedByCard(
      await readScope(ownerId),
      card,
    );

    expect(received).toEqual({ ARS: 0n, USD: 0n });
  });

  it('sums the USD received by exchanges exactly beyond 2^53 (error path of float handling)', async () => {
    const ownerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const bank = await newAccount(connection.pool, ownerId);
    for (let i = 0; i < 2; i += 1) {
      await newExchange(connection.pool, {
        ownerId,
        accountId: bank,
        destinationAccountId: card.usdAccountId,
        amount: 999_999_999_999_999n,
        destinationAmount: 999_999_999_999_999n,
        rate: 10_000n,
      });
    }
    await newExchange(connection.pool, {
      ownerId,
      accountId: bank,
      destinationAccountId: card.usdAccountId,
      amount: 2n,
      destinationAmount: 1n,
      rate: 20_000n,
    });

    const received = await createCardPayments(connection.db).receivedByCard(
      await readScope(ownerId),
      card,
    );

    expect(received.USD).toBe(1_999_999_999_999_999n);
  });

  it('sums exactly beyond 2^53, where a float would round (error path of float handling)', async () => {
    const ownerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const bank = await newAccount(connection.pool, ownerId);
    for (let i = 0; i < 10; i += 1) {
      await newTransfer(connection.pool, {
        ownerId,
        accountId: bank,
        destinationAccountId: card.arsAccountId,
        amount: 999_999_999_999_999n,
      });
    }
    await newTransfer(connection.pool, {
      ownerId,
      accountId: bank,
      destinationAccountId: card.arsAccountId,
      amount: 1n,
    });

    const received = await createCardPayments(connection.db).receivedByCard(
      await readScope(ownerId),
      card,
    );

    expect(received.ARS).toBe(9_999_999_999_999_991n);
  });

  it('answers zero for another user scope and for a card with no transfers (sad path)', async () => {
    const ownerId = await newUserId(connection.db);
    const otherId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const bank = await newAccount(connection.pool, ownerId);
    await newTransfer(connection.pool, {
      ownerId,
      accountId: bank,
      destinationAccountId: card.arsAccountId,
      amount: 6_000_000n,
    });
    const payments = createCardPayments(connection.db);

    expect(await payments.receivedByCard(await readScope(otherId), card)).toEqual({
      ARS: 0n,
      USD: 0n,
    });
    const emptyOwner = await newUserId(connection.db);
    const emptyCard = await newCard(emptyOwner);
    expect(await payments.receivedByCard(await readScope(emptyOwner), emptyCard)).toEqual({
      ARS: 0n,
      USD: 0n,
    });
  });
});

describe('createStatementPaymentRecorder.record', () => {
  it('stores a transfer from the source to the destination with the amount and date (AC-01)', async () => {
    const ownerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const bank = await newAccount(connection.pool, ownerId);
    const recorder = createStatementPaymentRecorder(connection.db, silent);
    const occurredAt = new Date(Date.now() - 60_000);

    const recorded = await recorder.record(await writeScope(ownerId), {
      sourceAccountId: bank,
      destinationAccountId: card.arsAccountId,
      amount: 6_000_000n,
      occurredAt,
      note: 'Visa',
    });

    const row = await connection.pool.query(
      `select type, account_id, destination_account_id, amount::text, note from movements where id = $1`,
      [recorded.id],
    );
    expect(row.rows).toEqual([
      {
        type: 'transfer',
        account_id: bank,
        destination_account_id: card.arsAccountId,
        amount: '6000000',
        note: 'Visa',
      },
    ]);
    expect(recorded.occurredAt).toEqual(occurredAt);
  });

  it('rejects a source of another currency with the transfer rule and stores nothing (AC-02)', async () => {
    const ownerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const usdBank = await newAccount(connection.pool, ownerId, false, 'USD');
    const recorder = createStatementPaymentRecorder(connection.db, silent);

    await expect(
      recorder.record(await writeScope(ownerId), {
        sourceAccountId: usdBank,
        destinationAccountId: card.arsAccountId,
        amount: 100n,
        occurredAt: new Date(Date.now() - 60_000),
      }),
    ).rejects.toMatchObject({ code: 'MOVEMENT_CURRENCY_MISMATCH' });
    const count = await connection.pool.query(
      'select count(*) as n from movements where owner_id = $1',
      [ownerId],
    );
    expect(count.rows[0]).toEqual({ n: '0' });
  });
});

describe('createStatementPaymentRecorder.record with pesos', () => {
  it('stores an exchange of the pesos debited into the card USD account with the implied rate', async () => {
    const ownerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const bank = await newAccount(connection.pool, ownerId);
    const recorder = createStatementPaymentRecorder(connection.db, silent);

    const recorded = await recorder.record(await writeScope(ownerId), {
      sourceAccountId: bank,
      destinationAccountId: card.usdAccountId,
      amount: 5_959n,
      pesosDebited: 9_147_065n,
      occurredAt: new Date(Date.now() - 60_000),
    });

    expect(recorded.exchange).toEqual({ pesosAmount: 9_147_065n, rate: 15_350_000n });
    const row = await connection.pool.query(
      `select type, account_id, destination_account_id, amount::text, destination_amount::text, rate::text, rate_source from movements where id = $1`,
      [recorded.id],
    );
    expect(row.rows).toEqual([
      {
        type: 'exchange',
        account_id: bank,
        destination_account_id: card.usdAccountId,
        amount: '9147065',
        destination_amount: '5959',
        rate: '15350000',
        rate_source: 'implied',
      },
    ]);
  });

  it('refuses an ARS source without pesos and a same-currency source with pesos, storing nothing (sad path)', async () => {
    const ownerId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const bank = await newAccount(connection.pool, ownerId);
    const usdBank = await newAccount(connection.pool, ownerId, false, 'USD');
    const recorder = createStatementPaymentRecorder(connection.db, silent);
    const common = { amount: 100n, occurredAt: new Date(Date.now() - 60_000) };

    await expect(
      recorder.record(await writeScope(ownerId), {
        ...common,
        sourceAccountId: bank,
        destinationAccountId: card.usdAccountId,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      recorder.record(await writeScope(ownerId), {
        ...common,
        sourceAccountId: usdBank,
        destinationAccountId: card.usdAccountId,
        pesosDebited: 100n,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const count = await connection.pool.query(
      'select count(*) as n from movements where owner_id = $1',
      [ownerId],
    );
    expect(count.rows[0]).toEqual({ n: '0' });
  });

  it('answers not found for a foreign source account (sad path)', async () => {
    const ownerId = await newUserId(connection.db);
    const otherId = await newUserId(connection.db);
    const card = await newCard(ownerId);
    const foreign = await newAccount(connection.pool, otherId);
    const recorder = createStatementPaymentRecorder(connection.db, silent);

    await expect(
      recorder.record(await writeScope(ownerId), {
        sourceAccountId: foreign,
        destinationAccountId: card.usdAccountId,
        amount: 100n,
        pesosDebited: 1_000n,
        occurredAt: new Date(Date.now() - 60_000),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
