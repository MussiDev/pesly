import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type {
  StatementCardPurchaseRow,
  StatementInstallmentRow,
} from '../../src/budgets/application/ports/spending-reader';

/** A card purchase row on the September statement (closing 24, due 5 Oct), 30,000.00 ARS. */
export function cardPurchaseRow(
  categoryId: string,
  overrides: Partial<StatementCardPurchaseRow> = {},
): StatementCardPurchaseRow {
  return {
    categoryId,
    currency: 'ARS',
    rate: 14000000n,
    sum: 3000000n,
    count: 1,
    period: '2026-09',
    dueDate: '2026-10-05',
    closingDay: 24,
    dueDay: 5,
    ...overrides,
  };
}

/** An installment row on the September statement, 10,000.00 ARS. */
export function installmentRow(
  categoryId: string,
  overrides: Partial<StatementInstallmentRow> = {},
): StatementInstallmentRow {
  return {
    categoryId,
    currency: 'ARS',
    sum: 1000000n,
    count: 1,
    period: '2026-09',
    dueDate: '2026-10-05',
    closingDay: 24,
    dueDay: 5,
    ...overrides,
  };
}

function firstId(rows: { id: string }[]): string {
  const row = rows[0];
  if (!row) throw new Error('The insert returned no row');
  return row.id;
}

/** A raw movement; `type` defaults to an expense in ARS-per-USD rate 14,000.0000 manual. */
export async function newMovementAt(
  pool: pg.Pool,
  fixture: {
    ownerId: string;
    accountId: string;
    categoryId: string;
    amount: bigint;
    occurredAt: Date | string;
    rate?: bigint;
    type?: 'expense' | 'income';
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
     values ($1, $2, $3, $4, $5, $6, $7, 'manual') returning id`,
    [
      fixture.ownerId,
      fixture.type ?? 'expense',
      fixture.accountId,
      fixture.categoryId,
      fixture.amount.toString(),
      fixture.occurredAt,
      (fixture.rate ?? 14000000n).toString(),
    ],
  );
  return firstId(result.rows);
}

export async function newChildCategory(
  pool: pg.Pool,
  ownerId: string,
  parentId: string,
  name = `Child ${randomUUID()}`,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into categories (owner_id, kind, parent_id, name, icon, color)
     values ($1, 'expense', $2, $3, 'wallet', 'blue') returning id`,
    [ownerId, parentId, name],
  );
  return firstId(result.rows);
}

export async function newNamedCategory(
  pool: pg.Pool,
  ownerId: string,
  fields: { name: string | null; defaultKey?: string },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into categories (owner_id, kind, name, default_key, icon, color)
     values ($1, 'expense', $2, $3, 'wallet', 'blue') returning id`,
    [ownerId, fields.name, fields.defaultKey ?? null],
  );
  return firstId(result.rows);
}

export async function newGroup(pool: pg.Pool): Promise<string> {
  const result = await pool.query<{ id: string }>(
    "insert into groups (name, default_rate_type) values ('Trip', 'blue') returning id",
  );
  return firstId(result.rows);
}

export async function newMember(
  pool: pg.Pool,
  groupId: string,
  userId: string | null,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    userId === null
      ? "insert into group_members (group_id, display_name) values ($1, 'Ghost') returning id"
      : 'insert into group_members (group_id, user_id) values ($1, $2) returning id',
    userId === null ? [groupId] : [groupId, userId],
  );
  return firstId(result.rows);
}

export async function newGroupCategory(
  pool: pg.Pool,
  groupId: string,
  fields: { name: string | null; defaultKey?: string },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into group_categories (group_id, name, default_key, icon, color)
     values ($1, $2, $3, 'wallet', 'blue') returning id`,
    [groupId, fields.name, fields.defaultKey ?? null],
  );
  return firstId(result.rows);
}

export async function newGroupExpense(
  pool: pg.Pool,
  fixture: {
    groupId: string;
    payerMemberId: string;
    categoryId: string;
    amount: bigint;
    currency?: 'ARS' | 'USD';
    occurredAt: Date | string;
    payerMovementId?: string | null;
    shares: { memberId: string; amount: bigint }[];
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into group_expenses (group_id, payer_member_id, created_by_member_id, amount, currency,
       occurred_at, category_id, description, split_mode, payer_movement_id)
     values ($1, $2, $2, $3, $4, $5, $6, 'Dinner', 'exact', $7) returning id`,
    [
      fixture.groupId,
      fixture.payerMemberId,
      fixture.amount.toString(),
      fixture.currency ?? 'ARS',
      fixture.occurredAt,
      fixture.categoryId,
      fixture.payerMovementId ?? null,
    ],
  );
  const expenseId = firstId(result.rows);
  for (const share of fixture.shares) {
    await pool.query(
      'insert into group_expense_shares (expense_id, member_id, group_id, amount) values ($1, $2, $3, $4)',
      [expenseId, share.memberId, fixture.groupId, share.amount.toString()],
    );
  }
  return expenseId;
}

export async function newBudgetWithVersions(
  pool: pg.Pool,
  fixture: {
    ownerId: string;
    currency?: 'ARS' | 'USD';
    versions: {
      effectiveFrom: string;
      name?: string;
      amount: bigint;
      rollover?: boolean;
      categoryIds: string[];
      thresholds?: number[];
    }[];
  },
): Promise<string> {
  const budget = await pool.query<{ id: string }>(
    'insert into budgets (owner_id, currency) values ($1, $2) returning id',
    [fixture.ownerId, fixture.currency ?? 'ARS'],
  );
  const budgetId = firstId(budget.rows);
  for (const version of fixture.versions) {
    const row = await pool.query<{ id: string }>(
      `insert into budget_versions (budget_id, owner_id, effective_from, name, amount, rollover)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        budgetId,
        fixture.ownerId,
        version.effectiveFrom,
        version.name ?? 'Food',
        version.amount.toString(),
        version.rollover ?? false,
      ],
    );
    const versionId = firstId(row.rows);
    for (const categoryId of version.categoryIds) {
      await pool.query(
        'insert into budget_version_categories (version_id, owner_id, category_id) values ($1, $2, $3)',
        [versionId, fixture.ownerId, categoryId],
      );
    }
    for (const percent of version.thresholds ?? [80, 100]) {
      await pool.query(
        'insert into budget_version_thresholds (version_id, owner_id, percent) values ($1, $2, $3)',
        [versionId, fixture.ownerId, percent],
      );
    }
  }
  return budgetId;
}

/** The text of every statement a pool received through `query`, from a `vi.spyOn(pool, 'query')`. */
export function statementsOf(calls: readonly unknown[][]): { text: string; values: unknown[] }[] {
  return calls.map(([first, second]) => {
    if (typeof first === 'string') {
      return { text: first, values: Array.isArray(second) ? (second as unknown[]) : [] };
    }
    const config = first as { text: string; values?: unknown[] };
    return { text: config.text, values: config.values ?? [] };
  });
}
