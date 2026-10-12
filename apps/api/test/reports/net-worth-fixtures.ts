import { randomUUID } from 'node:crypto';
import { localDayBounds, netWorthPointDates, monthsInRange } from '@pesly/shared';
import type pg from 'pg';
import type { NetWorthWindow } from '../../src/reports/application/ports/net-worth-sources';

export const ZONE = 'America/Argentina/Buenos_Aires';

function firstId(rows: { id: string }[]): string {
  const row = rows[0];
  if (!row) throw new Error('The insert returned no row');
  return row.id;
}

/** The window of the months `first` to `last` (`YYYY-MM`), the last one current when `today` is in it. */
export function windowFor(
  first: string,
  last: string,
  today: string,
  timeZone = ZONE,
): NetWorthWindow {
  const months = monthsInRange(`${first}-01`, `${last}-01`);
  const dates = netWorthPointDates(months, today);
  const points = months.map((month, index) => {
    const date = dates[index] ?? '';
    return { month, date, end: localDayBounds(date, date, timeZone).before };
  });
  const lastDate = dates[dates.length - 1] ?? '';
  return {
    start: localDayBounds(`${first}-01`, `${first}-01`, timeZone).from,
    end: localDayBounds(lastDate, lastDate, timeZone).before,
    timeZone,
    points,
  };
}

export async function accountWith(
  pool: pg.Pool,
  fixture: {
    ownerId: string;
    currency?: 'ARS' | 'USD';
    opening?: bigint;
    archived?: boolean;
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available, archived_at)
     values ($1, $2, 'cash', $3, $4, true, $5) returning id`,
    [
      fixture.ownerId,
      `Caja ${randomUUID()}`,
      fixture.currency ?? 'ARS',
      (fixture.opening ?? 0n).toString(),
      fixture.archived === true ? new Date() : null,
    ],
  );
  return firstId(result.rows);
}

export async function flowMovement(
  pool: pg.Pool,
  fixture: {
    ownerId: string;
    accountId: string;
    categoryId: string;
    type: 'expense' | 'income';
    amount: bigint;
    occurredAt: string;
  },
): Promise<void> {
  await pool.query(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
     values ($1, $2, $3, $4, $5, $6, 14000000, 'manual')`,
    [
      fixture.ownerId,
      fixture.type,
      fixture.accountId,
      fixture.categoryId,
      fixture.amount.toString(),
      fixture.occurredAt,
    ],
  );
}

export async function transferAt(
  pool: pg.Pool,
  fixture: {
    ownerId: string;
    accountId: string;
    destinationAccountId: string;
    amount: bigint;
    destinationAmount?: bigint;
    exchangeRate?: bigint;
    occurredAt: string;
  },
): Promise<void> {
  const exchange = fixture.exchangeRate !== undefined;
  await pool.query(
    `insert into movements (owner_id, type, account_id, destination_account_id, amount, destination_amount, occurred_at, rate, rate_source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      fixture.ownerId,
      exchange ? 'exchange' : 'transfer',
      fixture.accountId,
      fixture.destinationAccountId,
      fixture.amount.toString(),
      (fixture.destinationAmount ?? fixture.amount).toString(),
      fixture.occurredAt,
      exchange ? fixture.exchangeRate?.toString() : null,
      exchange ? 'implied' : null,
    ],
  );
}

export async function groupOf(pool: pg.Pool): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "insert into groups (name, default_rate_type) values ('Trip', 'blue') returning id",
  );
  return firstId(result.rows);
}

export async function memberOf(
  pool: pg.Pool,
  groupId: string,
  userId: string | null,
  left = false,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    userId === null
      ? "insert into group_members (group_id, display_name) values ($1, 'Ghost') returning id"
      : 'insert into group_members (group_id, user_id, left_at) values ($1, $2, $3) returning id',
    userId === null ? [groupId] : [groupId, userId, left ? new Date() : null],
  );
  return firstId(result.rows);
}

/** An expense paid by `payerMemberId` with its shares; the category is created for the group. */
export async function expenseOf(
  pool: pg.Pool,
  fixture: {
    groupId: string;
    payerMemberId: string;
    amount: bigint;
    occurredAt: string;
    currency?: 'ARS' | 'USD';
    shares: { memberId: string; amount: bigint }[];
  },
): Promise<void> {
  const category = await pool.query<{ id: string }>(
    `insert into group_categories (group_id, name, icon, color) values ($1, $2, 'wallet', 'blue') returning id`,
    [fixture.groupId, `Cat ${randomUUID()}`],
  );
  const expense = await pool.query<{ id: string }>(
    `insert into group_expenses (group_id, payer_member_id, created_by_member_id, amount, currency,
       occurred_at, category_id, description, split_mode)
     values ($1, $2, $2, $3, $4, $5, $6, 'Dinner', 'exact') returning id`,
    [
      fixture.groupId,
      fixture.payerMemberId,
      fixture.amount.toString(),
      fixture.currency ?? 'ARS',
      fixture.occurredAt,
      firstId(category.rows),
    ],
  );
  const expenseId = firstId(expense.rows);
  for (const share of fixture.shares) {
    await pool.query(
      'insert into group_expense_shares (expense_id, member_id, group_id, amount) values ($1, $2, $3, $4)',
      [expenseId, share.memberId, fixture.groupId, share.amount.toString()],
    );
  }
}

/** A settlement with one leg of the same amount (`from` pays `to`); optionally credited to an account. */
export async function settlementOf(
  pool: pg.Pool,
  fixture: {
    groupId: string;
    fromMemberId: string;
    toMemberId: string;
    amount: bigint;
    occurredAt: string;
    currency?: 'ARS' | 'USD';
    account?: { id: string; memberId: string };
  },
): Promise<void> {
  const currency = fixture.currency ?? 'ARS';
  const settlement = await pool.query<{ id: string }>(
    `insert into group_settlements (group_id, from_member_id, to_member_id, created_by_member_id, currency,
       amount, occurred_at, account_id, account_member_id)
     values ($1, $2, $3, $2, $4, $5, $6, $7, $8) returning id`,
    [
      fixture.groupId,
      fixture.fromMemberId,
      fixture.toMemberId,
      currency,
      fixture.amount.toString(),
      fixture.occurredAt,
      fixture.account?.id ?? null,
      fixture.account?.memberId ?? null,
    ],
  );
  await pool.query(
    'insert into group_settlement_legs (settlement_id, group_id, currency, amount) values ($1, $2, $3, $4)',
    [firstId(settlement.rows), fixture.groupId, currency, fixture.amount.toString()],
  );
}

export async function portfolioOf(
  pool: pg.Pool,
  ownerId: string,
  createdAt: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "insert into portfolios (owner_id, name, created_at) values ($1, 'Balanz', $2) returning id",
    [ownerId, createdAt],
  );
  return firstId(result.rows);
}

export async function snapshotOf(
  pool: pg.Pool,
  fixture: {
    portfolioId: string;
    ownerId: string;
    date: string;
    value: bigint;
    currency?: 'ARS' | 'USD';
  },
): Promise<void> {
  await pool.query(
    `insert into portfolio_value_snapshots (portfolio_id, owner_id, snapshot_date, currency, total_value, taken_at)
     values ($1, $2, $3, $4, $5, now())`,
    [
      fixture.portfolioId,
      fixture.ownerId,
      fixture.date,
      fixture.currency ?? 'ARS',
      fixture.value.toString(),
    ],
  );
}

/**
 * A card (closing day 20, due day 5 unless given) with a purchase of `count` installments of
 * `each` whose first statement is `firstPeriod`; `statements` stores the periods that exist.
 */
export async function installmentPurchaseOf(
  pool: pg.Pool,
  fixture: {
    ownerId: string;
    categoryId: string;
    purchasedOn: string;
    firstPeriod: string;
    count: number;
    each: bigint;
    currency?: 'ARS' | 'USD';
    closingDay?: number;
    dueDay?: number;
    statements?: { period: string; closingDate: string; dueDate: string }[];
  },
): Promise<void> {
  const ars = await accountWith(pool, { ownerId: fixture.ownerId, currency: 'ARS' });
  const usd = await accountWith(pool, { ownerId: fixture.ownerId, currency: 'USD' });
  const card = await pool.query<{ id: string }>(
    `insert into credit_cards (owner_id, name, closing_day, due_day, ars_account_id, usd_account_id)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      fixture.ownerId,
      `Visa ${randomUUID().slice(0, 8)}`,
      fixture.closingDay ?? 20,
      fixture.dueDay ?? 5,
      ars,
      usd,
    ],
  );
  const cardId = firstId(card.rows);
  for (const statement of fixture.statements ?? []) {
    await pool.query(
      `insert into credit_card_statements (card_id, owner_id, period, closing_date, due_date)
       values ($1, $2, $3, $4, $5)`,
      [cardId, fixture.ownerId, statement.period, statement.closingDate, statement.dueDate],
    );
  }
  const purchase = await pool.query<{ id: string }>(
    `insert into installment_purchases (owner_id, card_id, category_id, total_amount, currency, installment_count, purchased_on)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      fixture.ownerId,
      cardId,
      fixture.categoryId,
      (fixture.each * BigInt(fixture.count)).toString(),
      fixture.currency ?? 'ARS',
      fixture.count,
      fixture.purchasedOn,
    ],
  );
  const purchaseId = firstId(purchase.rows);
  let period = fixture.firstPeriod;
  for (let number = 1; number <= fixture.count; number += 1) {
    await pool.query(
      'insert into installments (purchase_id, owner_id, number, period, amount) values ($1, $2, $3, $4, $5)',
      [purchaseId, fixture.ownerId, number, period, fixture.each.toString()],
    );
    const year = Number.parseInt(period.slice(0, 4), 10);
    const month = Number.parseInt(period.slice(5, 7), 10);
    period =
      month === 12
        ? `${String(year + 1).padStart(4, '0')}-01`
        : `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}`;
  }
}
