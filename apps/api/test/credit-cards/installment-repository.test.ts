import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleCreditCardRepository } from '../../src/credit-cards/infrastructure/db/drizzle-credit-card-repository';
import { DrizzleInstallmentCategoryUsage } from '../../src/credit-cards/infrastructure/db/drizzle-installment-category-usage';
import { DrizzleInstallmentRepository } from '../../src/credit-cards/infrastructure/db/drizzle-installment-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newCategory, newUserId, readScope, writeScope } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let repository: DrizzleInstallmentRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleInstallmentRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const OCTOBER = { period: '2026-10', closingDate: '2026-10-24', dueDate: '2026-11-05' };

async function ownerWithCard() {
  const ownerId = await newUserId(connection.db);
  const scope = await writeScope(ownerId);
  const { card } = await new DrizzleCreditCardRepository(connection.db).create(scope, {
    name: 'Visa',
    closingDay: 24,
    dueDay: 5,
    firstStatement: OCTOBER,
  });
  const categoryId = await newCategory(connection.pool, ownerId, 'expense');
  return { ownerId, scope, card, categoryId };
}

const PERIODS = [
  '2026-10',
  '2026-11',
  '2026-12',
  '2027-01',
  '2027-02',
  '2027-03',
  '2027-04',
  '2027-05',
  '2027-06',
  '2027-07',
  '2027-08',
  '2027-09',
];

function installmentsOf(count: number, amount = 10000n) {
  return PERIODS.slice(0, count).map((period, index) => ({ number: index + 1, period, amount }));
}

/** The PostgreSQL error code of a rejected promise; Drizzle wraps the driver error as the cause. */
async function pgCodeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    const cause: unknown = error instanceof Error ? error.cause : undefined;
    return cause instanceof Error ? Reflect.get(cause, 'code') : undefined;
  }
  return undefined;
}

const count = async (statement: string, params: unknown[] = []): Promise<number> => {
  const result = await connection.pool.query<{ n: string }>(statement, params);
  return Number(result.rows[0]?.n);
};

describe('DrizzleInstallmentRepository', () => {
  it('stores a purchase of 12 installments with their periods and amounts (AC-01)', async () => {
    const { scope, card, categoryId } = await ownerWithCard();

    const purchase = await repository.create(scope, {
      cardId: card.id,
      categoryId,
      totalAmount: 120000n,
      purchasedOn: '2026-10-07',
      note: 'TV',
      installments: installmentsOf(12),
    });

    expect(purchase.installmentCount).toBe(12);
    const found = await repository.findPurchase(scope, card.id, purchase.id);
    expect(found?.installments).toHaveLength(12);
    expect(found?.installments[0]).toEqual({ number: 1, period: '2026-10', amount: 10000n });
    expect(found?.installments[11]?.period).toBe('2027-09');
    expect(found?.note).toBe('TV');
    expect((await repository.listPurchases(scope, card.id)).map((p) => p.id)).toEqual([
      purchase.id,
    ]);
  });

  it('gives another user a scope with nothing to read and nothing to change (AC-10, sad path)', async () => {
    const ana = await ownerWithCard();
    const purchase = await repository.create(ana.scope, {
      cardId: ana.card.id,
      categoryId: ana.categoryId,
      totalAmount: 20000n,
      purchasedOn: '2026-10-07',
      note: null,
      installments: installmentsOf(2),
    });
    const bob = await newUserId(connection.db);
    const bobWrite = await writeScope(bob);
    const bobRead = await readScope(bob);

    expect(await repository.listPurchases(bobRead, ana.card.id)).toEqual([]);
    expect(await repository.findPurchase(bobRead, ana.card.id, purchase.id)).toBeNull();
    expect(
      await repository.updatePurchase(bobWrite, ana.card.id, purchase.id, { note: 'hacked' }),
    ).toBeNull();
    expect(await repository.removeInstallments(bobWrite, ana.card.id, purchase.id, [1, 2])).toBe(
      false,
    );
    expect(await repository.listRows(bobRead)).toEqual([]);
    expect(await repository.cardHasPurchases(bobRead, ana.card.id)).toBe(false);
    expect((await repository.findPurchase(ana.scope, ana.card.id, purchase.id))?.note).toBeNull();
    expect(await count('select count(*) as n from installments')).toBe(2);
  });

  it('keeps the closed installments and cancels the purchase, then deletes it when none remain (AC-09)', async () => {
    const { scope, card, categoryId } = await ownerWithCard();
    const purchase = await repository.create(scope, {
      cardId: card.id,
      categoryId,
      totalAmount: 120000n,
      purchasedOn: '2026-10-07',
      note: null,
      installments: installmentsOf(12),
    });

    expect(
      await repository.removeInstallments(
        scope,
        card.id,
        purchase.id,
        [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      ),
    ).toBe(true);

    expect(await repository.findPurchase(scope, card.id, purchase.id)).toBeNull();
    expect(await repository.listPurchases(scope, card.id)).toEqual([]);
    const rows = await repository.listRows(scope, card.id);
    expect(rows.map((row) => row.number)).toEqual([1, 2]);
    expect(await repository.cardHasPurchases(scope, card.id)).toBe(true);
    expect(await repository.removeInstallments(scope, card.id, purchase.id, [1])).toBe(false);

    const second = await repository.create(scope, {
      cardId: card.id,
      categoryId,
      totalAmount: 20000n,
      purchasedOn: '2026-10-07',
      note: null,
      installments: installmentsOf(2),
    });
    expect(await repository.removeInstallments(scope, card.id, second.id, [1, 2])).toBe(true);
    expect(
      await count('select count(*) as n from installment_purchases where id = $1', [second.id]),
    ).toBe(0);
  });

  it('updates the category and the note of an active purchase only', async () => {
    const { ownerId, scope, card, categoryId } = await ownerWithCard();
    const other = await newCategory(connection.pool, ownerId, 'expense');
    const purchase = await repository.create(scope, {
      cardId: card.id,
      categoryId,
      totalAmount: 20000n,
      purchasedOn: '2026-10-07',
      note: 'a',
      installments: installmentsOf(2),
    });

    const updated = await repository.updatePurchase(scope, card.id, purchase.id, {
      categoryId: other,
      note: null,
    });

    expect(updated?.categoryId).toBe(other);
    expect(updated?.note).toBeNull();
    expect(updated?.installments).toHaveLength(2);
    expect(await repository.updatePurchase(scope, card.id, randomUUID(), { note: 'x' })).toBeNull();
  });

  it('lists the installment rows of cancelled purchases and reports a used category (FR-06)', async () => {
    const { scope, card, categoryId } = await ownerWithCard();
    const usage = new DrizzleInstallmentCategoryUsage(connection.db);
    expect(await usage.isUsed(categoryId)).toBe(false);
    const purchase = await repository.create(scope, {
      cardId: card.id,
      categoryId,
      totalAmount: 20000n,
      purchasedOn: '2026-10-07',
      note: null,
      installments: installmentsOf(2),
    });
    await repository.removeInstallments(scope, card.id, purchase.id, [2]);

    const rows = await repository.listRows(scope);

    expect(rows).toEqual([
      {
        cardId: card.id,
        purchaseId: purchase.id,
        number: 1,
        count: 2,
        period: '2026-10',
        amount: 10000n,
        categoryId,
      },
    ]);
    expect(await usage.isUsed(categoryId)).toBe(true);
  });

  it('rolls back the purchase when an installment row is refused (error path)', async () => {
    const { scope, card, categoryId } = await ownerWithCard();

    const code = await pgCodeOf(
      repository.create(scope, {
        cardId: card.id,
        categoryId,
        totalAmount: 20000n,
        purchasedOn: '2026-10-07',
        note: null,
        installments: [
          { number: 1, period: '2026-10', amount: 10000n },
          { number: 2, period: 'not-a-period', amount: 10000n },
        ],
      }),
    );

    expect(code).toBe('23514');

    expect(await count('select count(*) as n from installment_purchases')).toBe(0);
  });

  it('refuses an income category and a category of another owner at the database (sad path)', async () => {
    const { ownerId, scope, card } = await ownerWithCard();
    const income = await newCategory(connection.pool, ownerId, 'income');
    const foreign = await newCategory(connection.pool, await newUserId(connection.db), 'expense');
    const data = (categoryId: string) => ({
      cardId: card.id,
      categoryId,
      totalAmount: 20000n,
      purchasedOn: '2026-10-07',
      note: null,
      installments: installmentsOf(2),
    });

    expect(await pgCodeOf(repository.create(scope, data(income)))).toBe('23503');
    expect(await pgCodeOf(repository.create(scope, data(foreign)))).toBe('23503');
  });

  it('round-trips amounts above 2^53 exactly (NFR-01)', async () => {
    const { scope, card, categoryId } = await ownerWithCard();
    const purchase = await repository.create(scope, {
      cardId: card.id,
      categoryId,
      totalAmount: 999_999_999_999_999n,
      purchasedOn: '2026-10-07',
      note: null,
      installments: [
        { number: 1, period: '2026-10', amount: 499_999_999_999_999n },
        { number: 2, period: '2026-11', amount: 500_000_000_000_000n },
      ],
    });

    const found = await repository.findPurchase(scope, card.id, purchase.id);

    expect(found?.totalAmount).toBe(999_999_999_999_999n);
    expect(found?.installments.map((installment) => installment.amount)).toEqual([
      499_999_999_999_999n,
      500_000_000_000_000n,
    ]);
  });
});
