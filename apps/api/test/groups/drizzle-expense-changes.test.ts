import { randomUUID } from 'node:crypto';
import { AppError, DEFAULT_CATEGORIES, type ExpenseSnapshot } from '@pesly/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GroupRecordFormerMember,
  GroupSplitMemberInvalid,
  type DeleteGroupExpenseData,
  type NewGroupExpense,
  type UpdateGroupExpenseData,
} from '../../src/groups';
import { DrizzleGroupExpenseRepository } from '../../src/groups/infrastructure/db/drizzle-group-expense-repository';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import { DrizzlePayerMovementRecorder } from '../../src/groups/infrastructure/movements/drizzle-payer-movement-recorder';
import { ResourceNotFound } from '../../src/shared/access';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newUserId } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let groupsRepo: DrizzleGroupRepository;
let recorder: DrizzlePayerMovementRecorder;
let repository: DrizzleGroupExpenseRepository;

const NOW = new Date('2026-10-10T12:00:00.000Z');
const LATER = new Date('2026-10-10T13:00:00.000Z');
const HOUR = 60 * 60 * 1000;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  groupsRepo = new DrizzleGroupRepository(connection.db);
  recorder = new DrizzlePayerMovementRecorder(connection.db, { now: () => NOW });
  repository = new DrizzleGroupExpenseRepository(connection.db, recorder);
});

afterAll(async () => {
  await connection.pool.end();
});

beforeEach(async () => {
  await connection.pool.query(
    `insert into exchange_rates (rate_type, buy, sell, provider_updated_at, fetched_at)
     values ('mep', 12900000, 13000000, now(), now())`,
  );
});

interface World {
  ana: string;
  groupId: string;
  anaMember: string;
  beaMember: string;
  ghost: string;
  categoryId: string;
  otherCategoryId: string;
  accountId: string;
  personalCategoryId: string;
}

async function newWorld(): Promise<World> {
  const ana = await newUserId(connection.db);
  const bea = await newUserId(connection.db);
  const { group } = await groupsRepo.create({
    name: 'Casa',
    defaultRateType: 'mep',
    creatorUserId: ana,
    categories: DEFAULT_CATEGORIES.filter((c) => c.parentKey === null && c.kind === 'expense')
      .slice(0, 2)
      .map((c) => ({ defaultKey: c.key, name: null, icon: c.icon, color: c.color })),
  });
  const ghostMember = await groupsRepo.addGhost({
    groupId: group.id,
    displayName: 'Pedro',
    limit: 50,
  });
  const beaRow = await connection.pool.query<{ id: string }>(
    'insert into group_members (group_id, user_id) values ($1, $2) returning id',
    [group.id, bea],
  );
  const categories = await groupsRepo.listCategories(group.id);
  return {
    ana,
    groupId: group.id,
    anaMember: (await groupsRepo.findMember(group.id, ana))?.id ?? '',
    beaMember: beaRow.rows[0]?.id ?? '',
    ghost: ghostMember.id,
    categoryId: categories[0]?.id ?? '',
    otherCategoryId: categories[1]?.id ?? '',
    accountId: await newAccount(connection.pool, ana, false, 'ARS'),
    personalCategoryId: await newCategory(connection.pool, ana, 'expense'),
  };
}

function shares(amounts: [string, bigint][]) {
  return amounts.map(([memberId, amount]) => ({ memberId, amount, basisPoints: null }));
}

function expenseOf(w: World, overrides: Partial<NewGroupExpense> = {}): NewGroupExpense {
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
    shares: shares([
      [w.anaMember, 1_000_000n],
      [w.beaMember, 1_000_000n],
      [w.ghost, 1_000_000n],
    ]),
    activity: { action: 'expense_created', memberId: w.anaMember, createdAt: NOW },
    payerMovement: null,
    ...overrides,
  };
}

function movementOf(w: World, amount = 3_000_000n) {
  return {
    userId: w.ana,
    accountId: w.accountId,
    categoryId: w.personalCategoryId,
    amount,
    occurredAt: new Date(NOW.getTime() - HOUR),
    note: 'Supermercado',
    rateType: 'mep' as const,
  };
}

function snapshotOf(
  w: World,
  expense: {
    amount: bigint;
    occurredAt: Date;
    categoryId: string;
    description: string;
    splitMode: 'equal' | 'exact' | 'percentage';
    payerMemberId?: string;
    shares: { memberId: string; amount: bigint }[];
  },
): ExpenseSnapshot {
  return {
    amount: expense.amount.toString(),
    currency: 'ARS',
    occurredAt: expense.occurredAt.toISOString(),
    categoryId: expense.categoryId,
    description: expense.description,
    splitMode: expense.splitMode,
    payerMemberId: expense.payerMemberId ?? w.anaMember,
    shares: [...expense.shares]
      .sort((a, b) => (a.memberId < b.memberId ? -1 : 1))
      .map((s) => ({ memberId: s.memberId, amount: s.amount.toString() })),
  };
}

function updateOf(
  w: World,
  expenseId: string,
  before: ExpenseSnapshot,
  overrides: Partial<Omit<UpdateGroupExpenseData, 'activity'>> = {},
): UpdateGroupExpenseData {
  const amount = overrides.amount ?? 6_000_000n;
  const newShares =
    overrides.shares ??
    shares([
      [w.anaMember, amount / 2n],
      [w.beaMember, amount / 2n],
    ]);
  const occurredAt = overrides.occurredAt ?? new Date(NOW.getTime() - 2 * HOUR);
  const description = overrides.description ?? 'Verduleria';
  const categoryId = overrides.categoryId ?? w.otherCategoryId;
  return {
    groupId: w.groupId,
    expenseId,
    amount,
    occurredAt,
    categoryId,
    description,
    splitMode: 'exact',
    shares: newShares,
    rateType: 'mep',
    activity: {
      action: 'expense_updated',
      memberId: w.anaMember,
      createdAt: LATER,
      before,
      after: snapshotOf(w, {
        amount,
        occurredAt,
        categoryId,
        description,
        splitMode: 'exact',
        shares: newShares,
      }),
    },
  };
}

function deleteOf(w: World, expenseId: string, before: ExpenseSnapshot): DeleteGroupExpenseData {
  return {
    groupId: w.groupId,
    expenseId,
    rateType: 'mep',
    activity: {
      action: 'expense_deleted',
      memberId: w.anaMember,
      createdAt: LATER,
      before,
      after: null,
    },
  };
}

async function count(table: string, where = 'true', params: unknown[] = []): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    `select count(*) as n from ${table} where ${where}`,
    params,
  );
  return Number(result.rows[0]?.n);
}

async function accountBalance(accountId: string): Promise<string> {
  const result = await connection.pool.query<{ balance: string }>(
    `select (a.opening_balance - coalesce(sum(m.amount) filter (where m.type = 'expense'), 0))::text as balance
     from accounts a left join movements m on m.account_id = a.id where a.id = $1 group by a.id`,
    [accountId],
  );
  return result.rows[0]?.balance ?? '';
}

async function memberNet(groupId: string): Promise<Map<string, bigint>> {
  const result = await connection.pool.query<{ member_id: string; net: string }>(
    `select member_id, sum(net)::text as net from (
       select payer_member_id as member_id, amount as net from group_expenses where group_id = $1
       union all
       select member_id, -amount from group_expense_shares where group_id = $1
     ) t group by member_id`,
    [groupId],
  );
  return new Map(result.rows.map((row) => [row.member_id, BigInt(row.net)]));
}

interface LogRow {
  member_id: string;
  action: string;
  subject_id: string;
  created_at: Date;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

async function logRows(groupId: string, action: string): Promise<LogRow[]> {
  const result = await connection.pool.query<LogRow>(
    'select * from group_activity_log where group_id = $1 and action = $2 order by created_at, id',
    [groupId, action],
  );
  return result.rows;
}

async function stored(w: World, expense: NewGroupExpense) {
  const saved = await repository.saveExpense(expense);
  const before = snapshotOf(w, {
    amount: saved.amount,
    occurredAt: saved.occurredAt,
    categoryId: saved.categoryId,
    description: saved.description,
    splitMode: saved.splitMode,
    shares: saved.shares,
  });
  return { saved, before };
}

/** Polls until some backend of this database waits for a lock. */
async function waitForBlockedBackend(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await connection.pool.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((result.rows[0]?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('no backend is waiting for a lock');
}

async function withFailingLog(action: string, run: () => Promise<unknown>): Promise<unknown> {
  await connection.pool.query(`
    create function public.b4a_forced_failure() returns trigger language plpgsql
    as $$ begin if new.action = '${action}' then raise exception 'forced failure'; end if; return new; end $$`);
  await connection.pool.query(`
    create trigger b4a_forced_failure before insert on group_activity_log
    for each row execute function public.b4a_forced_failure()`);
  try {
    return await run().catch((e: unknown) => e);
  } finally {
    await connection.pool.query('drop trigger b4a_forced_failure on group_activity_log');
    await connection.pool.query('drop function public.b4a_forced_failure()');
  }
}

describe('updateExpense', () => {
  it('replaces the fields and the shares, moves the balances and logs the stored before and after', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w));

    const updated = await repository.updateExpense(updateOf(w, saved.id, before));

    expect(updated).toMatchObject({
      id: saved.id,
      amount: 6_000_000n,
      description: 'Verduleria',
      categoryId: w.otherCategoryId,
      splitMode: 'exact',
      payerMemberId: w.anaMember,
      createdByMemberId: w.anaMember,
    });
    expect(updated.shares.map((s) => s.amount)).toEqual([3_000_000n, 3_000_000n]);
    expect(await repository.getExpense(w.groupId, saved.id)).toEqual(updated);
    expect(await count('group_expense_shares', 'expense_id = $1', [saved.id])).toBe(2);
    const net = await memberNet(w.groupId);
    expect(net.get(w.anaMember)).toBe(3_000_000n);
    expect(net.get(w.beaMember)).toBe(-3_000_000n);
    expect(net.has(w.ghost)).toBe(false);
    const [row, ...rest] = await logRows(w.groupId, 'expense_updated');
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ member_id: w.anaMember, subject_id: saved.id });
    expect(row?.created_at.toISOString()).toBe(LATER.toISOString());
    expect(row?.before).toEqual(before);
    expect(row?.after?.amount).toBe('6000000');
    expect(typeof (row?.after?.shares as { amount: unknown }[])[0]?.amount).toBe('string');
  });

  it('rebuilds the before snapshot under lock instead of trusting the one it was given', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w));

    await repository.updateExpense(
      updateOf(w, saved.id, { ...before, description: 'forged', amount: '1' }),
    );

    const [row] = await logRows(w.groupId, 'expense_updated');
    expect(row?.before).toEqual(before);
  });

  it('rewrites the payer movement and the payer account balance follows, keeping the frozen rate', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w, { payerMovement: movementOf(w) }));
    expect(await accountBalance(w.accountId)).toBe('-3000000');
    await connection.pool.query('delete from exchange_rates');

    await repository.updateExpense(updateOf(w, saved.id, before));

    expect(await accountBalance(w.accountId)).toBe('-6000000');
    const movement = await connection.pool.query<{
      note: string;
      rate: string;
      account_id: string;
      category_id: string;
    }>('select * from movements where id = $1', [saved.payerMovementId]);
    expect(movement.rows[0]).toMatchObject({
      note: 'Verduleria',
      rate: '13000000',
      account_id: w.accountId,
      category_id: w.personalCategoryId,
    });
    expect(await count('movements')).toBe(1);
  });

  it('touches no movement when payer_movement_id is null', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w));
    const other = await connection.pool.query<{ id: string }>(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source, rate_type)
       values ($1, 'expense', $2, $3, 777, now(), 13000000, 'automatic', 'mep') returning id`,
      [w.ana, w.accountId, w.personalCategoryId],
    );

    await repository.updateExpense(updateOf(w, saved.id, before));

    const rows = await connection.pool.query<{ amount: string }>(
      'select amount from movements where id = $1',
      [other.rows[0]?.id],
    );
    expect(rows.rows[0]?.amount).toBe('777');
    expect(await count('movements')).toBe(1);
  });

  it('keeps a ghost payer without a movement and moves its balance', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w, { payerMemberId: w.ghost }));

    await repository.updateExpense(updateOf(w, saved.id, { ...before, payerMemberId: w.ghost }));

    expect((await memberNet(w.groupId)).get(w.ghost)).toBe(6_000_000n);
    expect(await count('movements')).toBe(0);
  });

  it('answers a missing expense or one of another group with ResourceNotFound and writes nothing (404)', async () => {
    const w = await newWorld();
    const other = await newWorld();
    const { saved, before } = await stored(other, expenseOf(other));

    await expect(
      repository.updateExpense(updateOf(w, randomUUID(), before)),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    await expect(repository.updateExpense(updateOf(w, saved.id, before))).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    expect(await logRows(w.groupId, 'expense_updated')).toHaveLength(0);
    expect(await logRows(other.groupId, 'expense_updated')).toHaveLength(0);
  });

  it('leaves everything unchanged when the write fails after the log insert (error)', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w, { payerMovement: movementOf(w) }));

    const failure = await withFailingLog('expense_updated', () =>
      repository.updateExpense(updateOf(w, saved.id, before)),
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AppError);
    expect((failure as Error).message + String((failure as Error).cause)).toContain(
      'forced failure',
    );
    expect(await repository.getExpense(w.groupId, saved.id)).toEqual(saved);
    expect(await logRows(w.groupId, 'expense_updated')).toHaveLength(0);
    expect(await accountBalance(w.accountId)).toBe('-3000000');
  });

  it('rolls the expense and the log back when the payer movement rewrite fails (error)', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w, { payerMovement: movementOf(w) }));
    const failing = new DrizzleGroupExpenseRepository(connection.db, {
      isUsable: (check) => recorder.isUsable(check),
      record: (tx, movement) => recorder.record(tx, movement),
      update: async (tx, change) => {
        await recorder.update(tx, change);
        throw new Error('forced failure');
      },
      remove: (tx, removal) => recorder.remove(tx, removal),
    });

    await expect(failing.updateExpense(updateOf(w, saved.id, before))).rejects.toThrow(
      'forced failure',
    );

    expect(await repository.getExpense(w.groupId, saved.id)).toEqual(saved);
    expect(await logRows(w.groupId, 'expense_updated')).toHaveLength(0);
    expect(await accountBalance(w.accountId)).toBe('-3000000');
  });

  it('answers 409 and changes nothing when a member who left would change balance', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w, { payerMovement: movementOf(w) }));
    await connection.pool.query('update group_members set left_at = now() where id = $1', [
      w.beaMember,
    ]);

    await expect(repository.updateExpense(updateOf(w, saved.id, before))).rejects.toBeInstanceOf(
      GroupRecordFormerMember,
    );

    expect(await repository.getExpense(w.groupId, saved.id)).toEqual(saved);
    expect(await logRows(w.groupId, 'expense_updated')).toHaveLength(0);
    expect(await accountBalance(w.accountId)).toBe('-3000000');
  });

  it('allows an edit that keeps the share of a member who left unchanged', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w));
    await connection.pool.query('update group_members set left_at = now() where id = $1', [
      w.beaMember,
    ]);

    const updated = await repository.updateExpense(
      updateOf(w, saved.id, before, {
        amount: 3_000_000n,
        shares: shares([
          [w.anaMember, 500_000n],
          [w.beaMember, 1_000_000n],
          [w.ghost, 1_500_000n],
        ]),
        description: 'Solo reparto',
      }),
    );

    expect(updated.shares.find((s) => s.memberId === w.beaMember)?.amount).toBe(1_000_000n);
  });

  it('maps a share for a member of another group to the typed member error (invalid)', async () => {
    const w = await newWorld();
    const other = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w));

    await expect(
      repository.updateExpense(
        updateOf(w, saved.id, before, {
          shares: shares([
            [w.anaMember, 3_000_000n],
            [other.beaMember, 3_000_000n],
          ]),
        }),
      ),
    ).rejects.toBeInstanceOf(GroupSplitMemberInvalid);

    expect(await repository.getExpense(w.groupId, saved.id)).toEqual(saved);
    expect(await logRows(w.groupId, 'expense_updated')).toHaveLength(0);
  });

  it('answers 404 when the acting member left and nothing is written (actor not active)', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w));
    await connection.pool.query('update group_members set left_at = now() where id = $1', [
      w.beaMember,
    ]);
    // Bea's balance does not move, so only the actor check can reject this edit.
    const sameShares = updateOf(w, saved.id, before, {
      amount: 3_000_000n,
      shares: shares([
        [w.anaMember, 1_000_000n],
        [w.beaMember, 1_000_000n],
        [w.ghost, 1_000_000n],
      ]),
    });

    await expect(
      repository.updateExpense({
        ...sameShares,
        activity: { ...sameShares.activity, memberId: w.beaMember },
      }),
    ).rejects.toBeInstanceOf(ResourceNotFound);

    expect(await repository.getExpense(w.groupId, saved.id)).toEqual(saved);
    expect(await logRows(w.groupId, 'expense_updated')).toHaveLength(0);
  });

  it('fails loudly and writes nothing when a movement hangs from an expense paid by a ghost (error)', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w, { payerMemberId: w.ghost }));
    const movement = await connection.pool.query<{ id: string }>(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source, rate_type)
       values ($1, 'expense', $2, $3, 777, now(), 13000000, 'automatic', 'mep') returning id`,
      [w.ana, w.accountId, w.personalCategoryId],
    );
    await connection.pool.query('update group_expenses set payer_movement_id = $1 where id = $2', [
      movement.rows[0]?.id,
      saved.id,
    ]);
    const corrupt = await repository.getExpense(w.groupId, saved.id);

    const failure: unknown = await repository
      .updateExpense(updateOf(w, saved.id, { ...before, payerMemberId: w.ghost }))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AppError);
    expect(failure).not.toBeInstanceOf(ResourceNotFound);
    expect((failure as Error).message).toContain('has no user');
    expect(await repository.getExpense(w.groupId, saved.id)).toEqual(corrupt);
    expect(await logRows(w.groupId, 'expense_updated')).toHaveLength(0);
    expect(await count('movements')).toBe(1);
  });

  it.each(['update', 'delete'] as const)(
    'does not deadlock with the payer deleting the movement meanwhile (%s, no 500)',
    async (kind) => {
      const w = await newWorld();
      const { saved, before } = await stored(w, expenseOf(w, { payerMovement: movementOf(w) }));
      const holder = await connection.pool.connect();
      let settled: Promise<unknown> | undefined;
      try {
        // The payer's own deletion holds the movement row; the expense change meets it first.
        await holder.query('begin');
        await holder.query('select id from movements where id = $1 for update', [
          saved.payerMovementId,
        ]);
        settled = (
          kind === 'update'
            ? repository.updateExpense(updateOf(w, saved.id, before))
            : repository.deleteExpense(deleteOf(w, saved.id, before))
        ).then(
          () => null,
          (error: unknown) => error,
        );
        await waitForBlockedBackend();
        // `on delete set null` now needs the expense row, which the change must not hold yet.
        await holder.query('delete from movements where id = $1', [saved.payerMovementId]);
        await holder.query('commit');
      } catch (error) {
        await holder.query('rollback');
        throw error;
      } finally {
        holder.release();
      }

      expect(await settled).toBeNull();
      expect(await count('movements')).toBe(0);
      const row = await repository.getExpense(w.groupId, saved.id);
      if (kind === 'update') {
        expect(row?.description).toBe('Verduleria');
        expect(row?.payerMovementId).toBeNull();
        expect(await logRows(w.groupId, 'expense_updated')).toHaveLength(1);
      } else {
        expect(row).toBeNull();
        expect(await logRows(w.groupId, 'expense_deleted')).toHaveLength(1);
      }
    },
  );

  it('serialises two concurrent edits of one expense and chains their before values', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w));

    await Promise.all([
      repository.updateExpense(updateOf(w, saved.id, before, { description: 'Primera' })),
      repository.updateExpense(updateOf(w, saved.id, before, { description: 'Segunda' })),
    ]);

    const rows = await logRows(w.groupId, 'expense_updated');
    expect(rows).toHaveLength(2);
    const pairs = rows.map((row) => [
      (row.before as { description?: string } | null)?.description,
      (row.after as { description?: string } | null)?.description,
    ]);
    const first = pairs.find(([b]) => b === 'Supermercado');
    const second = pairs.find(([b]) => b !== 'Supermercado');
    expect(first).toBeDefined();
    expect(second?.[0]).toBe(first?.[1]);
    expect((await repository.getExpense(w.groupId, saved.id))?.description).toBe(second?.[1]);
    expect(await count('group_expense_shares', 'expense_id = $1', [saved.id])).toBe(2);
  });
});

describe('deleteExpense', () => {
  it('removes the expense, its shares and the payer movement, restoring balances and the account', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w, { payerMovement: movementOf(w) }));

    await repository.deleteExpense(deleteOf(w, saved.id, before));

    expect(await repository.getExpense(w.groupId, saved.id)).toBeNull();
    expect(await count('group_expense_shares')).toBe(0);
    expect(await count('movements')).toBe(0);
    expect((await memberNet(w.groupId)).size).toBe(0);
    expect(await accountBalance(w.accountId)).toBe('0');
    const [row, ...rest] = await logRows(w.groupId, 'expense_deleted');
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ member_id: w.anaMember, subject_id: saved.id, after: null });
    expect(row?.before).toEqual(before);
    expect(row?.created_at.toISOString()).toBe(LATER.toISOString());
  });

  it('logs the stored before even when a forged before is sent (delete)', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w));

    await repository.deleteExpense(
      deleteOf(w, saved.id, { ...before, description: 'forged', amount: '1' }),
    );

    const [row] = await logRows(w.groupId, 'expense_deleted');
    expect(row?.before).toEqual(before);
  });

  it('answers 404 when the acting member left and keeps the expense (actor not active)', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(
      w,
      expenseOf(w, { shares: shares([[w.anaMember, 3_000_000n]]) }),
    );
    await connection.pool.query('update group_members set left_at = now() where id = $1', [
      w.beaMember,
    ]);
    const data = deleteOf(w, saved.id, before);

    await expect(
      repository.deleteExpense({ ...data, activity: { ...data.activity, memberId: w.beaMember } }),
    ).rejects.toBeInstanceOf(ResourceNotFound);

    expect(await repository.getExpense(w.groupId, saved.id)).toEqual(saved);
    expect(await logRows(w.groupId, 'expense_deleted')).toHaveLength(0);
  });

  it('fails loudly and keeps the expense when a movement hangs from an expense paid by a ghost (error)', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w, { payerMemberId: w.ghost }));
    const movement = await connection.pool.query<{ id: string }>(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source, rate_type)
       values ($1, 'expense', $2, $3, 777, now(), 13000000, 'automatic', 'mep') returning id`,
      [w.ana, w.accountId, w.personalCategoryId],
    );
    await connection.pool.query('update group_expenses set payer_movement_id = $1 where id = $2', [
      movement.rows[0]?.id,
      saved.id,
    ]);
    const corrupt = await repository.getExpense(w.groupId, saved.id);

    const failure: unknown = await repository
      .deleteExpense(deleteOf(w, saved.id, { ...before, payerMemberId: w.ghost }))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AppError);
    expect((failure as Error).message).toContain('has no user');
    expect(await repository.getExpense(w.groupId, saved.id)).toEqual(corrupt);
    expect(await logRows(w.groupId, 'expense_deleted')).toHaveLength(0);
    expect(await count('movements')).toBe(1);
  });

  it('touches no movement when payer_movement_id is null', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w));
    await connection.pool.query(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source, rate_type)
       values ($1, 'expense', $2, $3, 777, now(), 13000000, 'automatic', 'mep')`,
      [w.ana, w.accountId, w.personalCategoryId],
    );

    await repository.deleteExpense(deleteOf(w, saved.id, before));

    expect(await count('movements')).toBe(1);
  });

  it('answers a missing expense with ResourceNotFound and logs nothing (404)', async () => {
    const w = await newWorld();
    const { before } = await stored(w, expenseOf(w));

    await expect(
      repository.deleteExpense(deleteOf(w, randomUUID(), before)),
    ).rejects.toBeInstanceOf(ResourceNotFound);
    expect(await logRows(w.groupId, 'expense_deleted')).toHaveLength(0);
  });

  it('answers 409 and keeps everything when a member who left holds a share', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w, { payerMovement: movementOf(w) }));
    await connection.pool.query('update group_members set left_at = now() where id = $1', [
      w.beaMember,
    ]);

    await expect(repository.deleteExpense(deleteOf(w, saved.id, before))).rejects.toBeInstanceOf(
      GroupRecordFormerMember,
    );

    expect(await repository.getExpense(w.groupId, saved.id)).toEqual(saved);
    expect(await count('movements')).toBe(1);
    expect(await logRows(w.groupId, 'expense_deleted')).toHaveLength(0);
  });

  it('leaves everything unchanged when the write fails after the log insert (error)', async () => {
    const w = await newWorld();
    const { saved, before } = await stored(w, expenseOf(w, { payerMovement: movementOf(w) }));

    const failure = await withFailingLog('expense_deleted', () =>
      repository.deleteExpense(deleteOf(w, saved.id, before)),
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message + String((failure as Error).cause)).toContain(
      'forced failure',
    );
    expect(await repository.getExpense(w.groupId, saved.id)).toEqual(saved);
    expect(await count('movements')).toBe(1);
    expect(await logRows(w.groupId, 'expense_deleted')).toHaveLength(0);
  });
});
