import type pg from 'pg';

export {
  newChildCategory,
  newGroup,
  newGroupCategory,
  newGroupExpense,
  newMember,
  newMovementAt,
  newNamedCategory,
  statementsOf,
} from '../budgets/spending-fixtures';

function firstId(rows: { id: string }[]): string {
  const row = rows[0];
  if (!row) throw new Error('The insert returned no row');
  return row.id;
}

/** A card of the owner with its two linked accounts (ARS and USD) and the given cycle days. */
export async function newCard(
  pool: pg.Pool,
  fixture: {
    ownerId: string;
    arsAccountId: string;
    usdAccountId: string;
    closingDay?: number;
    dueDay?: number;
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into credit_cards (owner_id, name, closing_day, due_day, ars_account_id, usd_account_id)
     values ($1, 'Visa', $2, $3, $4, $5) returning id`,
    [
      fixture.ownerId,
      fixture.closingDay ?? 25,
      fixture.dueDay ?? 10,
      fixture.arsAccountId,
      fixture.usdAccountId,
    ],
  );
  return firstId(result.rows);
}

export async function newStatement(
  pool: pg.Pool,
  fixture: {
    cardId: string;
    ownerId: string;
    period: string;
    closingDate: string;
    dueDate: string;
  },
): Promise<void> {
  await pool.query(
    `insert into credit_card_statements (card_id, owner_id, period, closing_date, due_date)
     values ($1, $2, $3, $4, $5)`,
    [fixture.cardId, fixture.ownerId, fixture.period, fixture.closingDate, fixture.dueDate],
  );
}

/** A purchase with one installment row per `installments` entry, numbered from 1. */
export async function newInstallmentPurchase(
  pool: pg.Pool,
  fixture: {
    ownerId: string;
    cardId: string;
    categoryId: string;
    currency?: 'ARS' | 'USD';
    purchasedOn?: string;
    installments: { period: string; amount: bigint }[];
  },
): Promise<string> {
  const total = fixture.installments.reduce((sum, item) => sum + item.amount, 0n);
  const purchase = await pool.query<{ id: string }>(
    `insert into installment_purchases (owner_id, card_id, category_id, total_amount, currency, installment_count, purchased_on)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      fixture.ownerId,
      fixture.cardId,
      fixture.categoryId,
      total.toString(),
      fixture.currency ?? 'ARS',
      // The table requires 2 to 60; a test may store fewer installment rows than the count.
      Math.max(2, fixture.installments.length),
      fixture.purchasedOn ?? '2026-09-01',
    ],
  );
  const purchaseId = firstId(purchase.rows);
  for (const [index, item] of fixture.installments.entries()) {
    await pool.query(
      'insert into installments (purchase_id, owner_id, number, period, amount) values ($1, $2, $3, $4, $5)',
      [purchaseId, fixture.ownerId, index + 1, item.period, item.amount.toString()],
    );
  }
  return purchaseId;
}
