import type pg from 'pg';
import { DrizzleRecurringPaymentRepository } from '../../src/recurring';
import type { Database } from '../../src/shared/db/client';
import {
  newBudgetWithVersions,
  newGroup,
  newGroupCategory,
  newGroupExpense,
  newMember,
  newMovementAt,
} from '../budgets/spending-fixtures';
import { newCategory, writeScope } from '../movements/db-fixtures';
import { rentOf } from '../recurring/fixtures';

/** 16:00 UTC on 2026-10-06 is still 2026-10-06 in America/Argentina/Buenos_Aires. */
export const NOW = new Date('2026-10-06T16:00:00.000Z');
export const TODAY = '2026-10-06';
export const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

function firstId(rows: { id: string }[]): string {
  const row = rows[0];
  if (!row) throw new Error('The insert returned no row');
  return row.id;
}

export interface World {
  userId: string;
  accountArs: string;
  accountUsd: string;
  archivedAccount: string;
  food: string;
  fun: string;
  salary: string;
  cardId: string;
  statementId: string;
  funBudgetId: string;
  foodBudgetId: string;
  rentPaymentId: string;
  gymPaymentId: string;
}

async function account(
  pool: pg.Pool,
  ownerId: string,
  name: string,
  currency: 'ARS' | 'USD',
  opening: bigint,
  options: { archived?: boolean; type?: 'cash' | 'credit_card' } = {},
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available, archived_at)
     values ($1, $2, $3, $4, $5, $7, $6) returning id`,
    [
      ownerId,
      name,
      options.type ?? 'cash',
      currency,
      opening.toString(),
      options.archived ? new Date() : null,
      options.type !== 'credit_card',
    ],
  );
  return firstId(result.rows);
}

/** The stored current rates of the dashboard fixtures: one ARS-per-USD sell rate of 1,400.0000. */
export async function seedRate(pool: pg.Pool): Promise<void> {
  await pool.query(
    `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
     values ('mep', 14000000, 14000000, now(), now())
     on conflict (rate_type) do nothing`,
  );
}

/**
 * One user with every kind of data the dashboard reads, dated around 2026-10-06:
 * accounts (one archived), income and expenses in October and September, two budgets, a card
 * with installments and a stored closed statement due on 2026-10-09, two recurring payments
 * (one overdue, one due on 2026-10-09) and two holdings (one priced, one not).
 */
export async function seedWorld(
  connection: { db: Database; pool: pg.Pool },
  userId: string,
  label: string,
): Promise<World> {
  const { pool, db } = connection;
  const accountArs = await account(pool, userId, `${label} ARS`, 'ARS', 10000000n);
  const accountUsd = await account(pool, userId, `${label} USD`, 'USD', 100000n);
  const archivedAccount = await account(pool, userId, `${label} old`, 'ARS', 99999900n, {
    archived: true,
  });
  const cardArs = await account(pool, userId, `${label} card ARS`, 'ARS', 0n, {
    type: 'credit_card',
  });
  const cardUsd = await account(pool, userId, `${label} card USD`, 'USD', 0n, {
    type: 'credit_card',
  });
  const food = await newCategory(pool, userId, 'expense');
  const fun = await newCategory(pool, userId, 'expense');
  const salary = await newCategory(pool, userId, 'income');

  const movement = (
    accountId: string,
    categoryId: string,
    amount: bigint,
    day: string,
    type: 'expense' | 'income' = 'expense',
  ) =>
    newMovementAt(pool, {
      ownerId: userId,
      accountId,
      categoryId,
      amount,
      occurredAt: `${day}T15:00:00Z`,
      type,
    });
  await movement(accountArs, salary, 8000000n, '2026-10-01', 'income');
  await movement(accountArs, food, 2000000n, '2026-10-02');
  await movement(accountUsd, food, 2000n, '2026-10-03');
  await movement(accountArs, fun, 400000n, '2026-10-04');
  await movement(accountArs, food, 1000000n, '2026-09-02');
  await movement(accountArs, food, 1000000n, '2026-09-15');
  await movement(accountArs, salary, 6000000n, '2026-09-01', 'income');

  const funBudgetId = await newBudgetWithVersions(pool, {
    ownerId: userId,
    versions: [{ effectiveFrom: '2026-09-01', name: 'Fun', amount: 500000n, categoryIds: [fun] }],
  });
  const foodBudgetId = await newBudgetWithVersions(pool, {
    ownerId: userId,
    versions: [
      { effectiveFrom: '2026-09-01', name: 'Food', amount: 3000000n, categoryIds: [food] },
    ],
  });

  const card = await pool.query<{ id: string }>(
    `insert into credit_cards (owner_id, name, closing_day, due_day, ars_account_id, usd_account_id)
     values ($1, $2, 20, 5, $3, $4) returning id`,
    [userId, `${label} Visa`, cardArs, cardUsd],
  );
  const cardId = firstId(card.rows);
  const purchase = await pool.query<{ id: string }>(
    `insert into installment_purchases (owner_id, card_id, category_id, total_amount, currency,
                                        installment_count, purchased_on)
     values ($1, $2, $3, 2000000, 'ARS', 4, '2026-09-10') returning id`,
    [userId, cardId, food],
  );
  await pool.query(
    `insert into installments (purchase_id, owner_id, number, period, amount)
     select $1, $2, n, to_char(date '2026-09-01' + make_interval(months => n - 1), 'YYYY-MM'), 500000
       from generate_series(1, 4) as n`,
    [firstId(purchase.rows), userId],
  );
  const statement = await pool.query<{ id: string }>(
    `insert into credit_card_statements (card_id, owner_id, period, closing_date, due_date)
     values ($1, $2, '2026-09', '2026-09-20', '2026-10-09') returning id`,
    [cardId, userId],
  );

  const recurring = new DrizzleRecurringPaymentRepository(db);
  const scope = await writeScope(userId);
  const owner = { ownerId: userId, accountId: accountArs, categoryId: fun };
  const rent = await recurring.create(
    scope,
    rentOf(owner, {
      name: 'Rent',
      startDate: '2026-09-05',
      scheduleFrom: '2026-10-05',
      autoRecordingFrom: '2026-10-05',
    }),
  );
  const gym = await recurring.create(
    scope,
    rentOf(owner, {
      name: 'Gym',
      amount: 1500000n,
      dayOfMonth: 9,
      startDate: '2026-10-09',
      scheduleFrom: '2026-10-09',
      autoRecordingFrom: '2026-10-09',
    }),
  );

  const portfolio = await pool.query<{ id: string }>(
    'insert into portfolios (owner_id, name) values ($1, $2) returning id',
    [userId, `${label} broker`],
  );
  await pool.query(
    `insert into holdings (portfolio_id, owner_id, ticker, instrument_name, instrument_type, quantity,
                           valuation_currency, total_cost, unit_price, price_source, priced_at)
     values ($1, $2, 'AAA', 'Priced', 'stock', 200000000, 'ARS', 1000000, 150000, 'manual', now()),
            ($1, $2, 'BBB', 'Unpriced', 'stock', 100000000, 'ARS', 1000000, null, null, null)`,
    [firstId(portfolio.rows), userId],
  );

  return {
    userId,
    accountArs,
    accountUsd,
    archivedAccount,
    food,
    fun,
    salary,
    cardId,
    statementId: firstId(statement.rows),
    funBudgetId,
    foodBudgetId,
    rentPaymentId: rent.id,
    gymPaymentId: gym.id,
  };
}

/**
 * A group of `payer` and `other`: the payer paid 30,000.00 ARS and the shares are 10,000.00 for
 * the payer and 20,000.00 for the other member, so `other` owes the payer 20,000.00.
 */
export async function seedGroup(
  pool: pg.Pool,
  payer: string,
  other: string,
): Promise<{ groupId: string }> {
  const groupId = await newGroup(pool);
  const payerMember = await newMember(pool, groupId, payer);
  const otherMember = await newMember(pool, groupId, other);
  const category = await newGroupCategory(pool, groupId, { name: 'Outings' });
  await newGroupExpense(pool, {
    groupId,
    payerMemberId: payerMember,
    categoryId: category,
    amount: 3000000n,
    occurredAt: '2026-10-03T15:00:00Z',
    shares: [
      { memberId: payerMember, amount: 1000000n },
      { memberId: otherMember, amount: 2000000n },
    ],
  });
  return { groupId };
}
