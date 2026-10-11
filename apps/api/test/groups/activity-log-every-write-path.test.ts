import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  balancesByCurrency,
  consolidate,
  expenseSnapshot,
  pairLegs,
  settlementSnapshot,
  type GroupExpense,
  type GroupSettlement,
  type NewGroupExpense,
} from '../../src/groups';
import { DrizzleGroupExpenseRepository } from '../../src/groups/infrastructure/db/drizzle-group-expense-repository';
import { DrizzleGroupSettlementRepository } from '../../src/groups/infrastructure/db/drizzle-group-settlement-repository';
import { DrizzlePayerMovementRecorder } from '../../src/groups/infrastructure/movements/drizzle-payer-movement-recorder';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory } from '../movements/db-fixtures';
import {
  equalSplit,
  HOUR,
  insertExpensesSql,
  newDbWorld,
  NOW,
  plainSettlement,
  type DbWorld,
} from './settlement-db-world';

/** NFR-01: every write path of an expense or a settlement leaves exactly one log row. */

let connection: DatabaseConnection;
let expenses: DrizzleGroupExpenseRepository;
let settlements: DrizzleGroupSettlementRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  const recorder = new DrizzlePayerMovementRecorder(connection.db, { now: () => NOW });
  expenses = new DrizzleGroupExpenseRepository(connection.db, recorder);
  settlements = new DrizzleGroupSettlementRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

interface LogRow {
  id: string;
  action: string;
  member_id: string;
  subject_id: string;
  created_at: Date;
  before: unknown;
  after: unknown;
}

async function logOf(groupId: string): Promise<LogRow[]> {
  const result = await connection.pool.query<LogRow>(
    'select * from group_activity_log where group_id = $1 order by created_at, id',
    [groupId],
  );
  return result.rows;
}

/** No JSON number may appear anywhere in a stored snapshot (NFR-02): amounts are strings. */
function expectNoJsonNumber(value: unknown, path = '$'): void {
  expect(typeof value, path).not.toBe('number');
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      expectNoJsonNumber(item, `${path}[${i}]`);
    });
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) expectNoJsonNumber(item, `${path}.${key}`);
  }
}

interface Fixture {
  w: DbWorld;
  accountId: string;
  personalCategoryId: string;
}

async function fixture(): Promise<Fixture> {
  const w = await newDbWorld(connection.db, connection.pool, { ghosts: 2 });
  await connection.pool.query(
    `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
     values ('mep', 12900000, 13000000, now(), now())`,
  );
  return {
    w,
    accountId: await newAccount(connection.pool, w.userId, false, 'ARS'),
    personalCategoryId: await newCategory(connection.pool, w.userId, 'expense'),
  };
}

let tick = 0;
const instant = () => new Date(NOW.getTime() + ++tick * 60_000);

function newExpense(f: Fixture, withMovement: boolean, createdAt: Date): NewGroupExpense {
  const { w } = f;
  return {
    groupId: w.groupId,
    payerMemberId: w.anaMember,
    createdByMemberId: w.anaMember,
    amount: 3_000_000n,
    currency: 'ARS',
    occurredAt: new Date(NOW.getTime() - HOUR),
    categoryId: w.categoryId,
    description: 'Supermercado',
    splitMode: 'equal',
    shares: equalSplit(3_000_000n, w.memberIds).map((s) => ({ ...s, basisPoints: null })),
    activity: { action: 'expense_created', memberId: w.anaMember, createdAt },
    payerMovement: withMovement
      ? {
          userId: w.userId,
          accountId: f.accountId,
          categoryId: f.personalCategoryId,
          amount: 3_000_000n,
          occurredAt: new Date(NOW.getTime() - HOUR),
          note: 'Supermercado',
          rateType: 'mep',
        }
      : null,
  };
}

async function editExpense(f: Fixture, saved: GroupExpense, createdAt: Date): Promise<void> {
  const { w } = f;
  const amount = 4_000_000n;
  const shares = equalSplit(amount, w.memberIds.slice(0, 2)).map((s) => ({
    ...s,
    basisPoints: null,
  }));
  const occurredAt = new Date(NOW.getTime() - 2 * HOUR);
  await expenses.updateExpense({
    groupId: w.groupId,
    expenseId: saved.id,
    amount,
    occurredAt,
    categoryId: saved.categoryId,
    description: 'Verduleria',
    splitMode: 'exact',
    shares,
    rateType: 'mep',
    activity: {
      action: 'expense_updated',
      memberId: w.anaMember,
      createdAt,
      before: expenseSnapshot(saved),
      after: expenseSnapshot({
        ...saved,
        amount,
        occurredAt,
        description: 'Verduleria',
        splitMode: 'exact',
        shares,
      }),
    },
  });
}

async function deleteExpense(w: DbWorld, saved: GroupExpense, createdAt: Date): Promise<void> {
  await expenses.deleteExpense({
    groupId: w.groupId,
    expenseId: saved.id,
    rateType: 'mep',
    activity: {
      action: 'expense_deleted',
      memberId: w.anaMember,
      createdAt,
      before: expenseSnapshot(saved),
      after: null,
    },
  });
}

async function editSettlement(w: DbWorld, saved: GroupSettlement, createdAt: Date): Promise<void> {
  const amount = 1_000n;
  const legs = [{ currency: saved.currency, amount }];
  await settlements.updateSettlement({
    groupId: w.groupId,
    settlementId: saved.id,
    amount,
    occurredAt: saved.occurredAt,
    activity: {
      action: 'settlement_updated',
      memberId: w.anaMember,
      createdAt,
      before: settlementSnapshot(saved),
      after: settlementSnapshot({ ...saved, amount, legs }),
    },
  });
}

async function deleteSettlement(
  w: DbWorld,
  saved: GroupSettlement,
  createdAt: Date,
): Promise<void> {
  await settlements.deleteSettlement({
    groupId: w.groupId,
    settlementId: saved.id,
    activity: {
      action: 'settlement_deleted',
      memberId: w.anaMember,
      createdAt,
      before: settlementSnapshot(saved),
      after: null,
    },
  });
}

function createPlain(w: DbWorld, createdAt: Date): Promise<GroupSettlement> {
  return settlements.saveSettlement(
    plainSettlement(w, {
      activity: { action: 'settlement_created', memberId: w.anaMember, createdAt },
    }),
  );
}

async function createConsolidated(w: DbWorld, createdAt: Date): Promise<GroupSettlement> {
  const [ana, ghost] = [w.anaMember, w.memberIds[1] ?? ''];
  await insertExpensesSql(connection.pool, w, [
    {
      payer: ghost,
      amount: 400n,
      currency: 'USD',
      shares: [
        { memberId: ana, amount: 300n },
        { memberId: ghost, amount: 100n },
      ],
    },
  ]);
  // The ARS side comes from the earlier expense of the table; the USD side is seeded above.
  const balances = balancesByCurrency(await settlements.readBalanceSources(w.groupId));
  const legs = pairLegs(balances, ana, ghost);
  const rate = 10_000_000n;
  const result = consolidate(ana, ghost, legs, 'ARS', rate);
  return settlements.saveSettlement(
    plainSettlement(w, {
      fromMemberId: result.fromMemberId,
      toMemberId: result.toMemberId,
      currency: result.currency,
      amount: result.amount,
      legs: result.legs,
      rate: { value: rate, source: 'manual', type: null },
      consolidation: { memberIds: [ana, ghost], legs },
      activity: { action: 'settlement_created', memberId: ana, createdAt },
    }),
  );
}

interface WritePath {
  name: string;
  action: string;
  before: 'null' | 'set';
  after: 'null' | 'set';
  /** Performs the write and returns the id of the record it touched. */
  run: (createdAt: Date) => Promise<string>;
}

function writePaths(f: Fixture): WritePath[] {
  const { w } = f;
  let expense: GroupExpense | undefined;
  let plain: GroupSettlement | undefined;
  let consolidated: GroupSettlement | undefined;
  const need = <T>(value: T | undefined): T => {
    if (value === undefined) throw new Error('a previous write path did not run');
    return value;
  };
  return [
    {
      name: 'create expense with payer movement',
      action: 'expense_created',
      before: 'null',
      after: 'null',
      run: async (at) => {
        expense = await expenses.saveExpense(newExpense(f, true, at));
        return expense.id;
      },
    },
    {
      name: 'edit expense',
      action: 'expense_updated',
      before: 'set',
      after: 'set',
      run: async (at) => {
        const saved = need(expense);
        await editExpense(f, saved, at);
        return saved.id;
      },
    },
    {
      name: 'delete expense',
      action: 'expense_deleted',
      before: 'set',
      after: 'null',
      run: async (at) => {
        const saved = need(expense);
        const current = await expenses.getExpense(w.groupId, saved.id);
        await deleteExpense(w, need(current ?? undefined), at);
        return saved.id;
      },
    },
    {
      name: 'create expense without payer movement',
      action: 'expense_created',
      before: 'null',
      after: 'null',
      run: async (at) => {
        expense = await expenses.saveExpense(newExpense(f, false, at));
        return expense.id;
      },
    },
    {
      name: 'create plain settlement',
      action: 'settlement_created',
      before: 'null',
      after: 'null',
      run: async (at) => {
        plain = await createPlain(w, at);
        return plain.id;
      },
    },
    {
      name: 'edit settlement',
      action: 'settlement_updated',
      before: 'set',
      after: 'set',
      run: async (at) => {
        const saved = need(plain);
        await editSettlement(w, saved, at);
        return saved.id;
      },
    },
    {
      name: 'delete plain settlement',
      action: 'settlement_deleted',
      before: 'set',
      after: 'null',
      run: async (at) => {
        const saved = need(plain);
        const current = await settlements.getSettlement(w.groupId, saved.id);
        await deleteSettlement(w, need(current ?? undefined), at);
        return saved.id;
      },
    },
    {
      name: 'create consolidated settlement',
      action: 'settlement_created',
      before: 'null',
      after: 'null',
      run: async (at) => {
        consolidated = await createConsolidated(w, at);
        return consolidated.id;
      },
    },
    {
      name: 'delete consolidated settlement',
      action: 'settlement_deleted',
      before: 'set',
      after: 'null',
      run: async (at) => {
        const saved = need(consolidated);
        await deleteSettlement(w, saved, at);
        return saved.id;
      },
    },
  ];
}

describe('every write path of expenses and settlements leaves one log row', () => {
  it('logs each write path exactly once with the right action, member, instant and string amounts', async () => {
    const f = await fixture();
    const { w } = f;
    let previousCount = 0;
    const paths = writePaths(f);
    expect(paths).toHaveLength(9);

    for (const path of paths) {
      const known = new Set((await logOf(w.groupId)).map((row) => row.id));
      const createdAt = instant();
      const subjectId = await path.run(createdAt);

      const rows = await logOf(w.groupId);
      expect(rows.length, path.name).toBeGreaterThanOrEqual(previousCount);
      expect(rows.length, path.name).toBe(known.size + 1);
      previousCount = rows.length;
      const added = rows.filter((row) => !known.has(row.id));
      expect(added, path.name).toHaveLength(1);
      const [row] = added;
      expect(row?.action, path.name).toBe(path.action);
      expect(row?.subject_id, path.name).toBe(subjectId);
      expect(row?.member_id, path.name).toBe(w.anaMember);
      expect(row?.created_at.toISOString(), path.name).toBe(createdAt.toISOString());
      expect(row?.before === null, path.name).toBe(path.before === 'null');
      expect(row?.after === null, path.name).toBe(path.after === 'null');
    }

    const rows = await logOf(w.groupId);
    expect(rows.map((row) => row.action)).toEqual(paths.map((path) => path.action));
    for (const row of rows) {
      expectNoJsonNumber(row.before, `${row.action}.before`);
      expectNoJsonNumber(row.after, `${row.action}.after`);
    }
  });

  it('leaves no log row and no record when the write fails after the log insert (error)', async () => {
    const f = await fixture();
    const { w } = f;
    await connection.pool.query(`
      create function public.b4b_every_path_failure() returns trigger language plpgsql
      as $$ begin if new.group_id = '${w.groupId}' then raise exception 'forced failure'; end if; return new; end $$`);
    await connection.pool.query(`
      create trigger b4b_every_path_failure before insert on group_activity_log
      for each row execute function public.b4b_every_path_failure()`);
    let expenseFailure: unknown;
    let settlementFailure: unknown;
    try {
      expenseFailure = await expenses
        .saveExpense(newExpense(f, true, instant()))
        .catch((error: unknown) => error);
      settlementFailure = await createPlain(w, instant()).catch((error: unknown) => error);
    } finally {
      await connection.pool.query('drop trigger b4b_every_path_failure on group_activity_log');
      await connection.pool.query('drop function public.b4b_every_path_failure()');
    }

    expect(expenseFailure).toBeInstanceOf(Error);
    expect(settlementFailure).toBeInstanceOf(Error);
    expect(await logOf(w.groupId)).toHaveLength(0);
    for (const table of [
      'group_expenses',
      'group_expense_shares',
      'group_settlements',
      'group_settlement_legs',
      'movements',
    ]) {
      const count = await connection.pool.query<{ n: string }>(
        `select count(*) as n from ${table}`,
      );
      expect(count.rows[0]?.n, table).toBe('0');
    }
  });

  it('refuses a direct update or delete of a log row with the trigger error while the group exists', async () => {
    const f = await fixture();
    const { w } = f;
    await expenses.saveExpense(newExpense(f, false, instant()));
    const [row] = await logOf(w.groupId);

    await expect(
      connection.pool.query(
        "update group_activity_log set action = 'expense_deleted' where id = $1",
        [row?.id],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      connection.pool.query(
        'update group_activity_log set created_at = now() where group_id = $1',
        [w.groupId],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      connection.pool.query('delete from group_activity_log where id = $1', [row?.id]),
    ).rejects.toThrow(/immutable/);
    await expect(
      connection.pool.query('delete from group_activity_log where group_id = $1', [w.groupId]),
    ).rejects.toThrow(/immutable/);
    expect(await logOf(w.groupId)).toHaveLength(1);
    // A missing group id matches no row, so the statement is a no-op rather than a trigger error.
    const noop = await connection.pool.query('delete from group_activity_log where group_id = $1', [
      randomUUID(),
    ]);
    expect(noop.rowCount).toBe(0);
  });
});
