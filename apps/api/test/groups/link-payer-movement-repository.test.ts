import { AUTOMATIC_SEND_CATEGORY_KEY, DEFAULT_CATEGORIES } from '@pesly/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GroupExpenseAlreadyLinked,
  GroupMovementAlreadySent,
  GroupMovementChanged,
  GroupMovementMismatch,
  GroupPayerOnly,
  type LinkPayerMovementData,
} from '../../src/groups';
import { DrizzleGroupExpenseRepository } from '../../src/groups/infrastructure/db/drizzle-group-expense-repository';
import { DrizzleGroupRepository } from '../../src/groups/infrastructure/db/drizzle-group-repository';
import { DrizzlePayerMovementRecorder } from '../../src/groups/infrastructure/movements/drizzle-payer-movement-recorder';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newCategory, newUserId } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let groupsRepo: DrizzleGroupRepository;
let recorder: DrizzlePayerMovementRecorder;
let repository: DrizzleGroupExpenseRepository;

const NOW = new Date('2026-10-10T12:00:00.000Z');
const OCCURRED_AT = new Date('2026-10-10T10:00:00.000Z');
const AMOUNT = 4_000_000n;
const OTHER = DEFAULT_CATEGORIES.find((c) => c.key === AUTOMATIC_SEND_CATEGORY_KEY);

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
  bea: string;
  groupId: string;
  anaMember: string;
  beaMember: string;
  accountId: string;
  personalCategoryId: string;
  expenseId: string;
}

/** Ana pays an expense of 40,000.00 ARS that nobody linked to a movement of hers. */
async function newWorld(): Promise<World> {
  const ana = await newUserId(connection.db);
  const bea = await newUserId(connection.db);
  const { group } = await groupsRepo.create({
    name: 'Casa',
    defaultRateType: 'mep',
    creatorUserId: ana,
    categories: OTHER
      ? [{ defaultKey: OTHER.key, name: null, icon: OTHER.icon, color: OTHER.color }]
      : [],
  });
  const beaRow = await connection.pool.query<{ id: string }>(
    'insert into group_members (group_id, user_id) values ($1, $2) returning id',
    [group.id, bea],
  );
  const anaMember = (await groupsRepo.findMember(group.id, ana))?.id ?? '';
  const beaMember = beaRow.rows[0]?.id ?? '';
  const category = await connection.pool.query<{ id: string }>(
    'select id from group_categories where group_id = $1 limit 1',
    [group.id],
  );
  const expense = await connection.pool.query<{ id: string }>(
    `insert into group_expenses (group_id, payer_member_id, created_by_member_id, amount, currency,
       occurred_at, category_id, description, split_mode)
     values ($1, $2, $3, $4, 'ARS', $5, $6, 'Supermercado', 'equal') returning id`,
    [group.id, anaMember, beaMember, AMOUNT.toString(), OCCURRED_AT, category.rows[0]?.id],
  );
  const expenseId = expense.rows[0]?.id ?? '';
  for (const memberId of [anaMember, beaMember]) {
    await connection.pool.query(
      'insert into group_expense_shares (expense_id, member_id, group_id, amount) values ($1, $2, $3, $4)',
      [expenseId, memberId, group.id, (AMOUNT / 2n).toString()],
    );
  }
  return {
    ana,
    bea,
    groupId: group.id,
    anaMember,
    beaMember,
    accountId: await newAccount(connection.pool, ana, false, 'ARS'),
    personalCategoryId: await newCategory(connection.pool, ana, 'expense'),
    expenseId,
  };
}

const createLink = (w: World): LinkPayerMovementData => ({
  groupId: w.groupId,
  expenseId: w.expenseId,
  payerUserId: w.ana,
  link: {
    mode: 'create',
    movement: {
      userId: w.ana,
      accountId: w.accountId,
      categoryId: w.personalCategoryId,
      amount: AMOUNT,
      occurredAt: OCCURRED_AT,
      note: 'Supermercado',
      rateType: 'mep',
    },
  },
});

async function movementRow(w: World, amount = AMOUNT): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, note, rate, rate_source)
     values ($1, 'expense', $2, $3, $4, $5, 'Nota propia', 14000000, 'manual') returning id`,
    [w.ana, w.accountId, w.personalCategoryId, amount.toString(), OCCURRED_AT],
  );
  return result.rows[0]?.id ?? '';
}

async function stored(w: World) {
  const result = await connection.pool.query<{
    payer_movement_id: string | null;
    adopted_movement: boolean;
    version: number;
  }>('select payer_movement_id, adopted_movement, version from group_expenses where id = $1', [
    w.expenseId,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error('no expense');
  return row;
}

async function movements(w: World): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    'select count(*) as n from movements where owner_id = $1',
    [w.ana],
  );
  return Number(result.rows[0]?.n);
}

describe('DrizzleGroupExpenseRepository.linkPayerMovement', () => {
  it('applies exactly one of 20 simultaneous links and rejects the rest with a conflict, leaving one movement (AC-28)', async () => {
    const w = await newWorld();

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => repository.linkPayerMovement(createLink(w))),
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(19);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(GroupExpenseAlreadyLinked);
    }
    expect(await movements(w)).toBe(1);
    expect((await stored(w)).payer_movement_id).not.toBeNull();
  });

  it('applies exactly one of simultaneous adoptions of the same movement by two expenses (AC-13, AC-28)', async () => {
    const w = await newWorld();
    const other = await connection.pool.query<{ id: string }>(
      `insert into group_expenses (group_id, payer_member_id, created_by_member_id, amount, currency,
         occurred_at, category_id, description, split_mode)
       select group_id, payer_member_id, created_by_member_id, amount, currency, occurred_at,
              category_id, 'Otro', split_mode from group_expenses where id = $1 returning id`,
      [w.expenseId],
    );
    const movementId = await movementRow(w);
    const adopt = (expenseId: string): LinkPayerMovementData => ({
      groupId: w.groupId,
      expenseId,
      payerUserId: w.ana,
      link: {
        mode: 'adopt',
        movementId,
        expectedAmount: AMOUNT,
        expectedOccurredAt: OCCURRED_AT,
      },
    });

    const results = await Promise.allSettled([
      repository.linkPayerMovement(adopt(w.expenseId)),
      repository.linkPayerMovement(adopt(other.rows[0]?.id ?? '')),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((result) => result.status === 'rejected');
    expect(lost?.status === 'rejected' && lost.reason).toBeInstanceOf(GroupMovementAlreadySent);
  });

  it('writes only the two link columns: the version stays and no log row is added (AC-17)', async () => {
    const w = await newWorld();
    const logBefore = await connection.pool.query<{ n: string }>(
      'select count(*) as n from group_activity_log where group_id = $1',
      [w.groupId],
    );
    const before = await stored(w);

    await repository.linkPayerMovement(createLink(w));

    const after = await stored(w);
    const logAfter = await connection.pool.query<{ n: string }>(
      'select count(*) as n from group_activity_log where group_id = $1',
      [w.groupId],
    );
    expect(after.version).toBe(before.version);
    expect(after.adopted_movement).toBe(false);
    expect(logAfter.rows[0]?.n).toBe(logBefore.rows[0]?.n);
  });

  it('fails with a conflict when the movement changed between the read and the lock, linking nothing', async () => {
    const w = await newWorld();
    const movementId = await movementRow(w);
    await connection.pool.query('update movements set amount = $1 where id = $2', [
      (AMOUNT + 1n).toString(),
      movementId,
    ]);

    await expect(
      repository.linkPayerMovement({
        groupId: w.groupId,
        expenseId: w.expenseId,
        payerUserId: w.ana,
        link: {
          mode: 'adopt',
          movementId,
          expectedAmount: AMOUNT,
          expectedOccurredAt: OCCURRED_AT,
        },
      }),
    ).rejects.toBeInstanceOf(GroupMovementChanged);
    expect((await stored(w)).payer_movement_id).toBeNull();
  });

  it('refuses the link when the currency of the movement no longer matches the expense after the lock (error)', async () => {
    const w = await newWorld();
    const movementId = await movementRow(w);
    await connection.pool.query("update group_expenses set currency = 'USD' where id = $1", [
      w.expenseId,
    ]);

    await expect(
      repository.linkPayerMovement({
        groupId: w.groupId,
        expenseId: w.expenseId,
        payerUserId: w.ana,
        link: {
          mode: 'adopt',
          movementId,
          expectedAmount: AMOUNT,
          expectedOccurredAt: OCCURRED_AT,
        },
      }),
    ).rejects.toBeInstanceOf(GroupMovementMismatch);
    expect((await stored(w)).payer_movement_id).toBeNull();
  });

  it('forbids a link by someone who is not the payer, even when the caller reaches the repository (error)', async () => {
    const w = await newWorld();

    await expect(
      repository.linkPayerMovement({ ...createLink(w), payerUserId: w.bea }),
    ).rejects.toBeInstanceOf(GroupPayerOnly);
    expect(await movements(w)).toBe(0);
    expect((await stored(w)).payer_movement_id).toBeNull();
  });

  it('rolls the movement back when the write fails after it was recorded (error)', async () => {
    const w = await newWorld();
    const failing = new DrizzleGroupExpenseRepository(connection.db, {
      isUsable: (check) => recorder.isUsable(check),
      peekAdoptable: (userId, movementId) => recorder.peekAdoptable(userId, movementId),
      lockForAdoption: (tx, userId, movementId) => recorder.lockForAdoption(tx, userId, movementId),
      listCandidates: (userId, query) => recorder.listCandidates(userId, query),
      record: async (tx, movement) => {
        await recorder.record(tx, movement);
        throw new Error('forced failure');
      },
      update: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    });

    await expect(failing.linkPayerMovement(createLink(w))).rejects.toThrow('forced failure');

    expect(await movements(w)).toBe(0);
    expect((await stored(w)).payer_movement_id).toBeNull();
  });
});
