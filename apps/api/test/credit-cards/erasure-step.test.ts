import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eraseUserCreditCards } from '../../src/credit-cards/infrastructure/db/erase-user-credit-cards';
import { DrizzleCreditCardRepository } from '../../src/credit-cards/infrastructure/db/drizzle-credit-card-repository';
import { DrizzleUserDeletionRepository } from '../../src/identity/infrastructure/db/drizzle-user-deletion-repository';
import { eraseUserMovements } from '../../src/movements';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { DrizzleInstallmentRepository } from '../../src/credit-cards/infrastructure/db/drizzle-installment-repository';
import { newCategory, newUserId, writeScope } from '../movements/db-fixtures';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const count = async (statement: string, params: unknown[]): Promise<number> => {
  const result = await connection.pool.query<{ n: string }>(statement, params);
  return Number(result.rows[0]?.n);
};

const cardsOf = (ownerId: string) =>
  count('select count(*) as n from credit_cards where owner_id = $1', [ownerId]);
const statementsOf = (ownerId: string) =>
  count('select count(*) as n from credit_card_statements where owner_id = $1', [ownerId]);
const usersWith = (id: string) => count('select count(*) as n from users where id = $1', [id]);

async function userWithCard(): Promise<string> {
  const ownerId = await newUserId(connection.db);
  await new DrizzleCreditCardRepository(connection.db).create(await writeScope(ownerId), {
    name: 'Visa',
    closingDay: 24,
    dueDay: 5,
    firstStatement: { period: '2026-10', closingDate: '2026-10-24', dueDate: '2026-11-05' },
  });
  return ownerId;
}

const erase = (
  userId: string,
  steps: ConstructorParameters<typeof DrizzleUserDeletionRepository>[1],
) =>
  new DrizzleUserDeletionRepository(connection.db, steps).erase({ userId, credentialsVersion: 0 });

describe('eraseUserCreditCards', () => {
  it("deletes only the user's cards and statements, leaving another user's", async () => {
    const ana = await userWithCard();
    const bea = await userWithCard();

    await connection.db.transaction((tx) => eraseUserCreditCards(tx, ana));

    expect(await cardsOf(ana)).toBe(0);
    expect(await statementsOf(ana)).toBe(0);
    expect(await cardsOf(bea)).toBe(1);
    expect(await statementsOf(bea)).toBe(1);
  });

  it('lets a user with a card be erased when registered after the movements step', async () => {
    const ana = await userWithCard();

    await erase(ana, [eraseUserMovements, eraseUserCreditCards]);

    expect(await usersWith(ana)).toBe(0);
    expect(await cardsOf(ana)).toBe(0);
  });

  it('is needed because the restricting keys refuse to delete the accounts first (sad path)', async () => {
    // The cascade from users does not fix an order; if the accounts go before the cards, the
    // restricting keys refuse it. The step removes the cards first so no order can fail.
    const ana = await userWithCard();

    await expect(
      connection.pool.query('delete from accounts where owner_id = $1', [ana]),
    ).rejects.toMatchObject({ code: '23503' });
    expect(await cardsOf(ana)).toBe(1);

    await connection.db.transaction((tx) => eraseUserCreditCards(tx, ana));
    await connection.pool.query('delete from accounts where owner_id = $1', [ana]);
    expect(await count('select count(*) as n from accounts where owner_id = $1', [ana])).toBe(0);
  });

  it('deletes the installment purchases before the cards so no restricting key refuses (sad path of ordering)', async () => {
    const ana = await userWithCard();
    const scope = await writeScope(ana);
    const card = (await new DrizzleCreditCardRepository(connection.db).list(scope))[0];
    if (!card) throw new Error('The card was not created');
    await new DrizzleInstallmentRepository(connection.db).create(scope, {
      cardId: card.id,
      categoryId: await newCategory(connection.pool, ana, 'expense'),
      totalAmount: 1000n,
      purchasedOn: '2026-10-01',
      note: null,
      installments: [
        { number: 1, period: '2026-10', amount: 500n },
        { number: 2, period: '2026-11', amount: 500n },
      ],
    });

    await erase(ana, [eraseUserMovements, eraseUserCreditCards]);

    expect(await usersWith(ana)).toBe(0);
    expect(
      await count('select count(*) as n from installment_purchases where owner_id = $1', [ana]),
    ).toBe(0);
  });
});
