import { randomUUID } from 'node:crypto';
import {
  AUTOMATIC_SEND_CATEGORY_KEY,
  DEFAULT_CATEGORIES,
  type ExpenseSnapshot,
} from '@pesly/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GroupMovementAlreadySent,
  GroupMovementChanged,
  type NewGroupExpense,
} from '../../src/groups';
import { DrizzleActivityLogReader } from '../../src/groups/infrastructure/db/drizzle-activity-log-reader';
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
  groupId: string;
  anaMember: string;
  beaMember: string;
  beaUser: string;
  accountId: string;
  personalCategoryId: string;
}

async function newWorld(withOther = false): Promise<World> {
  const ana = await newUserId(connection.db);
  const bea = await newUserId(connection.db);
  const { group } = await groupsRepo.create({
    name: 'Casa',
    defaultRateType: 'mep',
    creatorUserId: ana,
    categories:
      withOther && OTHER
        ? [{ defaultKey: OTHER.key, name: null, icon: OTHER.icon, color: OTHER.color }]
        : [],
  });
  const beaRow = await connection.pool.query<{ id: string }>(
    'insert into group_members (group_id, user_id) values ($1, $2) returning id',
    [group.id, bea],
  );
  return {
    ana,
    groupId: group.id,
    anaMember: (await groupsRepo.findMember(group.id, ana))?.id ?? '',
    beaMember: beaRow.rows[0]?.id ?? '',
    beaUser: bea,
    accountId: await newAccount(connection.pool, ana, false, 'ARS'),
    personalCategoryId: await newCategory(connection.pool, ana, 'expense'),
  };
}

interface MovementRow {
  id: string;
  amount: string;
  note: string | null;
  account_id: string;
  category_id: string;
  rate: string;
  occurred_at: Date;
}

async function newMovementRow(w: World, amount = 4_000_000n, type = 'expense'): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, note, rate, rate_source)
     values ($1, $2, $3, $4, $5, $6, 'Nota propia', 14000000, 'manual') returning id`,
    [
      w.ana,
      type,
      w.accountId,
      type === 'expense' ? w.personalCategoryId : null,
      amount.toString(),
      new Date(NOW.getTime() - HOUR),
    ],
  );
  return result.rows[0]?.id ?? '';
}

async function movementRow(id: string): Promise<MovementRow | undefined> {
  const result = await connection.pool.query<MovementRow>('select * from movements where id = $1', [
    id,
  ]);
  return result.rows[0];
}

function sendOf(
  w: World,
  movementId: string,
  overrides: Partial<NewGroupExpense> = {},
  amount = 4_000_000n,
): NewGroupExpense {
  const half = amount / 2n;
  return {
    groupId: w.groupId,
    payerMemberId: w.anaMember,
    createdByMemberId: w.anaMember,
    amount,
    currency: 'ARS',
    occurredAt: new Date(NOW.getTime() - HOUR),
    categoryId: null,
    description: 'Nota propia',
    splitMode: 'equal',
    shares: [
      { memberId: w.anaMember, amount: half, basisPoints: null },
      { memberId: w.beaMember, amount: amount - half, basisPoints: null },
    ],
    activity: {
      action: 'expense_created',
      memberId: w.anaMember,
      createdAt: NOW,
      fromMovement: true,
    },
    payerMovement: null,
    adoptedMovement: {
      userId: w.ana,
      movementId,
      expectedAmount: amount,
      expectedOccurredAt: new Date(NOW.getTime() - HOUR),
    },
    ...overrides,
  };
}

async function count(table: string, where = 'true', params: unknown[] = []): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    `select count(*) as n from ${table} where ${where}`,
    params,
  );
  return Number(result.rows[0]?.n);
}

async function tallies(w: World, movementId?: string) {
  return {
    expenses: await count('group_expenses', 'group_id = $1', [w.groupId]),
    shares: await count('group_expense_shares', 'group_id = $1', [w.groupId]),
    log: await count('group_activity_log', 'group_id = $1', [w.groupId]),
    categories: await count('group_categories', 'group_id = $1', [w.groupId]),
    movements: await count('movements'),
    movement: movementId === undefined ? null : await movementRow(movementId),
  };
}

describe('saveExpense adopting a movement', () => {
  it('links the movement, inserts no movement row and leaves it untouched', async () => {
    const w = await newWorld(true);
    const movementId = await newMovementRow(w);
    const before = await tallies(w, movementId);

    const saved = await repository.saveExpense(sendOf(w, movementId));

    expect(saved.payerMovementId).toBe(movementId);
    expect(saved.adoptedMovement).toBe(true);
    expect(saved.autoCategory).toBeNull();
    const after = await tallies(w, movementId);
    expect(after.movements).toBe(before.movements);
    expect(after.movement).toEqual(before.movement);
    expect(after.expenses).toBe(1);
    expect(after.shares).toBe(2);
    const log = await connection.pool.query<{
      from_movement: boolean;
      auto_category: string | null;
    }>('select from_movement, auto_category from group_activity_log where group_id = $1', [
      w.groupId,
    ]);
    expect(log.rows).toEqual([{ from_movement: true, auto_category: null }]);
  });

  it('writes distinct links for 100 sends of 100 movements', async () => {
    const w = await newWorld(true);
    const ids: string[] = [];
    for (let i = 0; i < 100; i += 1) ids.push(await newMovementRow(w, 1_000n + BigInt(i)));
    for (const [i, id] of ids.entries()) {
      await repository.saveExpense(sendOf(w, id, {}, 1_000n + BigInt(i)));
    }
    const distinct = await connection.pool.query<{ n: string }>(
      'select count(distinct payer_movement_id) as n from group_expenses where group_id = $1',
      [w.groupId],
    );
    expect(Number(distinct.rows[0]?.n)).toBe(100);
    expect(await count('group_activity_log', 'group_id = $1 and from_movement', [w.groupId])).toBe(
      100,
    );
  });

  it('answers 409 to a second send and creates nothing', async () => {
    const w = await newWorld(true);
    const movementId = await newMovementRow(w);
    await repository.saveExpense(sendOf(w, movementId));
    const before = await tallies(w);

    await expect(repository.saveExpense(sendOf(w, movementId))).rejects.toBeInstanceOf(
      GroupMovementAlreadySent,
    );
    expect(await tallies(w)).toEqual(before);
  });

  it('gives 1 success and 19 conflicts for 20 concurrent sends of one movement', async () => {
    const w = await newWorld();
    const movementId = await newMovementRow(w);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => repository.saveExpense(sendOf(w, movementId))),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(19);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(GroupMovementAlreadySent);
    const after = await tallies(w);
    expect(after).toMatchObject({ expenses: 1, shares: 2, log: 1, categories: 1 });
  });

  it('creates one category and 20 expenses for 20 concurrent sends of 20 movements', async () => {
    const w = await newWorld();
    const ids = await Promise.all(Array.from({ length: 20 }, () => newMovementRow(w)));

    await Promise.all(ids.map((id) => repository.saveExpense(sendOf(w, id))));

    expect(
      await count('group_categories', 'group_id = $1 and default_key = $2', [
        w.groupId,
        AUTOMATIC_SEND_CATEGORY_KEY,
      ]),
    ).toBe(1);
    const used = await connection.pool.query<{ n: string }>(
      `select count(*) as n from group_expenses e join group_categories c on c.id = e.category_id
       where e.group_id = $1 and c.default_key = $2`,
      [w.groupId, AUTOMATIC_SEND_CATEGORY_KEY],
    );
    expect(Number(used.rows[0]?.n)).toBe(20);
    expect(
      await count('group_activity_log', "group_id = $1 and auto_category = 'created'", [w.groupId]),
    ).toBe(1);
  });
});

describe('automatic category', () => {
  it('creates it with the default key, icon, color and a null name, logged as created', async () => {
    const w = await newWorld();
    const saved = await repository.saveExpense(sendOf(w, await newMovementRow(w)));

    expect(saved.autoCategory).toBe('created');
    const category = await connection.pool.query<{
      id: string;
      name: string | null;
      icon: string;
      color: string;
    }>('select id, name, icon, color from group_categories where group_id = $1', [w.groupId]);
    expect(category.rows).toEqual([
      { id: saved.categoryId, name: null, icon: OTHER?.icon, color: OTHER?.color },
    ]);
    const log = await connection.pool.query<{ auto_category: string; member_id: string }>(
      'select auto_category, member_id from group_activity_log where group_id = $1',
      [w.groupId],
    );
    expect(log.rows).toEqual([{ auto_category: 'created', member_id: w.anaMember }]);
  });

  it('restores an archived one and writes nothing when it is active', async () => {
    const w = await newWorld(true);
    await connection.pool.query(
      'update group_categories set archived_at = now() where group_id = $1',
      [w.groupId],
    );
    const restored = await repository.saveExpense(sendOf(w, await newMovementRow(w)));
    expect(restored.autoCategory).toBe('restored');
    expect(
      await count('group_categories', 'group_id = $1 and archived_at is null', [w.groupId]),
    ).toBe(1);

    const before = await connection.pool.query(
      'select * from group_categories where group_id = $1',
      [w.groupId],
    );
    const active = await repository.saveExpense(sendOf(w, await newMovementRow(w)));
    expect(active.autoCategory).toBeNull();
    const after = await connection.pool.query(
      'select * from group_categories where group_id = $1',
      [w.groupId],
    );
    expect(after.rows).toEqual(before.rows);
    const kinds = await connection.pool.query<{ auto_category: string | null }>(
      'select auto_category from group_activity_log where group_id = $1 order by created_at, id',
      [w.groupId],
    );
    expect(kinds.rows.map((r) => r.auto_category).sort()).toEqual([null, 'restored']);
  });

  it('is created for a member who is not an admin', async () => {
    const w = await newWorld();
    const beaAccount = await newAccount(connection.pool, w.beaUser, false, 'ARS');
    const beaCategory = await newCategory(connection.pool, w.beaUser, 'expense');
    const own = await connection.pool.query<{ id: string }>(
      `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
       values ($1, 'expense', $2, $3, 5000, $4, 14000000, 'manual') returning id`,
      [w.beaUser, beaAccount, beaCategory, new Date(NOW.getTime() - HOUR)],
    );
    const id = own.rows[0]?.id ?? '';

    const saved = await repository.saveExpense({
      ...sendOf(w, id, {}, 5_000n),
      payerMemberId: w.beaMember,
      createdByMemberId: w.beaMember,
      activity: {
        action: 'expense_created',
        memberId: w.beaMember,
        createdAt: NOW,
        fromMovement: true,
      },
      adoptedMovement: {
        userId: w.beaUser,
        movementId: id,
        expectedAmount: 5_000n,
        expectedOccurredAt: new Date(NOW.getTime() - HOUR),
      },
    });

    expect(saved.autoCategory).toBe('created');
  });
});

function reasonOf(result: PromiseSettledResult<unknown> | undefined): unknown {
  return result?.status === 'rejected' ? result.reason : undefined;
}

async function personalCategory(
  w: World,
  fields: { defaultKey: string | null; parentId?: string },
): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    `insert into categories (owner_id, kind, parent_id, default_key, name, icon, color)
     values ($1, 'expense', $2, $3, $4, 'wallet', 'blue') returning id`,
    [
      w.ana,
      fields.parentId ?? null,
      fields.defaultKey,
      fields.defaultKey === null ? 'Custom' : null,
    ],
  );
  return result.rows[0]?.id ?? '';
}

async function groupCategory(w: World, key: string, archived = false): Promise<string> {
  const result = await connection.pool.query<{ id: string }>(
    `insert into group_categories (group_id, default_key, name, icon, color, archived_at)
     values ($1, $2, null, 'wallet', 'blue', $3) returning id`,
    [w.groupId, key, archived ? new Date() : null],
  );
  return result.rows[0]?.id ?? '';
}

async function defaultKeyOf(categoryId: string): Promise<string | null> {
  const result = await connection.pool.query<{ default_key: string | null }>(
    'select default_key from group_categories where id = $1',
    [categoryId],
  );
  return result.rows[0]?.default_key ?? null;
}

describe('automatic category follows the personal category (05i D18)', () => {
  it('uses the equivalent group category with no marker and creates nothing', async () => {
    const w = await newWorld();
    const food = await groupCategory(w, 'food');
    w.personalCategoryId = await personalCategory(w, { defaultKey: 'food' });
    const before = await count('group_categories', 'group_id = $1', [w.groupId]);

    const saved = await repository.saveExpense(sendOf(w, await newMovementRow(w)));

    expect(saved.categoryId).toBe(food);
    expect(saved.autoCategory).toBeNull();
    expect(await count('group_categories', 'group_id = $1', [w.groupId])).toBe(before);
    const log = await connection.pool.query<{ auto_category: string | null }>(
      'select auto_category from group_activity_log where group_id = $1',
      [w.groupId],
    );
    expect(log.rows).toEqual([{ auto_category: null }]);
  });

  it('maps a child personal category to its root', async () => {
    const w = await newWorld();
    const food = await groupCategory(w, 'food');
    const root = await personalCategory(w, { defaultKey: 'food' });
    w.personalCategoryId = await personalCategory(w, {
      defaultKey: 'food.groceries',
      parentId: root,
    });

    const saved = await repository.saveExpense(sendOf(w, await newMovementRow(w)));

    expect(saved.categoryId).toBe(food);
    expect(saved.autoCategory).toBeNull();
  });

  it('falls back to other-expenses for a custom personal category', async () => {
    const w = await newWorld();
    await groupCategory(w, 'food');
    w.personalCategoryId = await personalCategory(w, { defaultKey: null });

    const saved = await repository.saveExpense(sendOf(w, await newMovementRow(w)));

    expect(await defaultKeyOf(saved.categoryId)).toBe(AUTOMATIC_SEND_CATEGORY_KEY);
    expect(saved.autoCategory).toBe('created');
  });

  it('falls back when the equivalent is archived and leaves it archived', async () => {
    const w = await newWorld();
    const food = await groupCategory(w, 'food', true);
    w.personalCategoryId = await personalCategory(w, { defaultKey: 'food' });

    const saved = await repository.saveExpense(sendOf(w, await newMovementRow(w)));

    expect(saved.categoryId).not.toBe(food);
    expect(await defaultKeyOf(saved.categoryId)).toBe(AUTOMATIC_SEND_CATEGORY_KEY);
    expect(saved.autoCategory).toBe('created');
    expect(await count('group_categories', 'id = $1 and archived_at is not null', [food])).toBe(1);
  });

  it('falls back and creates no food category when the group has none', async () => {
    const w = await newWorld();
    w.personalCategoryId = await personalCategory(w, { defaultKey: 'food' });

    const saved = await repository.saveExpense(sendOf(w, await newMovementRow(w)));

    expect(await defaultKeyOf(saved.categoryId)).toBe(AUTOMATIC_SEND_CATEGORY_KEY);
    expect(saved.autoCategory).toBe('created');
    expect(
      await count('group_categories', "group_id = $1 and default_key = 'food'", [w.groupId]),
    ).toBe(0);
  });

  it('lets a supplied categoryId win over the equivalent', async () => {
    const w = await newWorld();
    await groupCategory(w, 'food');
    const chosen = await groupCategory(w, 'transport');
    w.personalCategoryId = await personalCategory(w, { defaultKey: 'food' });

    const saved = await repository.saveExpense(
      sendOf(w, await newMovementRow(w), { categoryId: chosen }),
    );

    expect(saved.categoryId).toBe(chosen);
    expect(saved.autoCategory).toBeNull();
  });

  it('returns the personal category id and its default key from the peek', async () => {
    const w = await newWorld();
    w.personalCategoryId = await personalCategory(w, { defaultKey: 'food' });
    const movementId = await newMovementRow(w);
    const custom = await personalCategory(w, { defaultKey: null });
    const customMovement = await newMovementRow({ ...w, personalCategoryId: custom });

    expect(await recorder.peekAdoptable(w.ana, movementId)).toMatchObject({
      categoryId: w.personalCategoryId,
      categoryDefaultKey: 'food',
    });
    expect(await recorder.peekAdoptable(w.ana, customMovement)).toMatchObject({
      categoryId: custom,
      categoryDefaultKey: null,
    });
  });

  it('uses the equivalent for 20 concurrent sends and creates nothing', async () => {
    const w = await newWorld();
    const food = await groupCategory(w, 'food');
    w.personalCategoryId = await personalCategory(w, { defaultKey: 'food' });
    const ids = await Promise.all(Array.from({ length: 20 }, () => newMovementRow(w)));

    const results = await Promise.all(ids.map((id) => repository.saveExpense(sendOf(w, id))));

    expect(results.every((r) => r.categoryId === food && r.autoCategory === null)).toBe(true);
    expect(await count('group_categories', 'group_id = $1', [w.groupId])).toBe(1);
  });
});

describe('refusals write nothing', () => {
  it('leaves every count and the movement as they were, with no category created', async () => {
    const w = await newWorld();
    const movementId = await newMovementRow(w);
    const linked = await newMovementRow(w);
    await repository.saveExpense(sendOf(w, linked, { categoryId: null }));
    const before = await tallies(w, movementId);
    const beforeCategories = await count('group_categories', 'group_id = $1', [w.groupId]);

    const attempts: Promise<unknown>[] = [
      repository.saveExpense(sendOf(w, linked)),
      repository.saveExpense(sendOf(w, randomUUID())),
      repository.saveExpense(
        sendOf(w, movementId, {
          adoptedMovement: {
            userId: w.ana,
            movementId,
            expectedAmount: 1n,
            expectedOccurredAt: new Date(NOW.getTime() - HOUR),
          },
        }),
      ),
      repository.saveExpense(sendOf(w, movementId, { categoryId: randomUUID() })),
      repository.saveExpense(
        sendOf(w, movementId, {
          shares: [{ memberId: randomUUID(), amount: 4_000_000n, basisPoints: null }],
        }),
      ),
    ];
    const settled = await Promise.allSettled(attempts);
    expect(settled.every((r) => r.status === 'rejected')).toBe(true);
    expect(reasonOf(settled[0])).toBeInstanceOf(GroupMovementAlreadySent);
    expect(reasonOf(settled[1])).toBeInstanceOf(ResourceNotFound);
    expect(reasonOf(settled[2])).toBeInstanceOf(GroupMovementChanged);

    const after = await tallies(w, movementId);
    expect(after).toEqual(before);
    expect(await count('group_categories', 'group_id = $1', [w.groupId])).toBe(beforeCategories);
  });

  it('does not create the automatic category when the send is refused', async () => {
    const w = await newWorld();
    const movementId = await newMovementRow(w);
    await expect(
      repository.saveExpense(
        sendOf(w, movementId, {
          shares: [{ memberId: randomUUID(), amount: 4_000_000n, basisPoints: null }],
        }),
      ),
    ).rejects.toBeDefined();
    expect(await count('group_categories', 'group_id = $1', [w.groupId])).toBe(0);
  });
});

function snapshotOf(
  w: World,
  amount: bigint,
  occurredAt: Date,
  categoryId: string,
): ExpenseSnapshot {
  const half = amount / 2n;
  return {
    amount: amount.toString(),
    currency: 'ARS',
    occurredAt: occurredAt.toISOString(),
    categoryId,
    description: 'Nota propia',
    splitMode: 'equal',
    payerMemberId: w.anaMember,
    shares: [
      { memberId: w.anaMember, amount: half.toString() },
      { memberId: w.beaMember, amount: (amount - half).toString() },
    ].sort((a, b) => (a.memberId < b.memberId ? -1 : 1)),
  };
}

describe('changing and deleting an adopted expense', () => {
  it('moves the amount and date of the movement and keeps its note, account, category and rate', async () => {
    const w = await newWorld();
    const movementId = await newMovementRow(w);
    const saved = await repository.saveExpense(sendOf(w, movementId));
    const original = await movementRow(movementId);
    const newDate = new Date(NOW.getTime() - 3 * HOUR);
    const half = 3_000_000n;

    await repository.updateExpense({
      groupId: w.groupId,
      expenseId: saved.id,
      baseVersion: 1,
      amount: 6_000_000n,
      occurredAt: newDate,
      categoryId: saved.categoryId,
      description: 'Descripcion del grupo',
      splitMode: 'equal',
      shares: [
        { memberId: w.anaMember, amount: half, basisPoints: null },
        { memberId: w.beaMember, amount: half, basisPoints: null },
      ],
      rateType: 'mep',
      activity: {
        action: 'expense_updated',
        memberId: w.anaMember,
        createdAt: LATER,
        before: snapshotOf(w, 4_000_000n, new Date(NOW.getTime() - HOUR), saved.categoryId),
        after: {
          ...snapshotOf(w, 6_000_000n, newDate, saved.categoryId),
          description: 'Descripcion del grupo',
        },
      },
    });

    const row = await movementRow(movementId);
    expect(row?.amount).toBe('6000000');
    expect(row?.occurred_at.toISOString()).toBe(newDate.toISOString());
    expect(row?.note).toBe(original?.note);
    expect(row?.account_id).toBe(original?.account_id);
    expect(row?.category_id).toBe(original?.category_id);
    expect(row?.rate).toBe(original?.rate);
  });

  it('keeps the movement when an adopted expense is deleted and logs the deletion', async () => {
    const w = await newWorld();
    const movementId = await newMovementRow(w);
    const saved = await repository.saveExpense(sendOf(w, movementId));
    const original = await movementRow(movementId);

    await repository.deleteExpense({
      groupId: w.groupId,
      expenseId: saved.id,
      baseVersion: 1,
      rateType: 'mep',
      activity: {
        action: 'expense_deleted',
        memberId: w.anaMember,
        createdAt: LATER,
        before: snapshotOf(w, 4_000_000n, new Date(NOW.getTime() - HOUR), saved.categoryId),
        after: null,
      },
    });

    expect(await movementRow(movementId)).toEqual(original);
    expect(await count('group_expenses', 'group_id = $1', [w.groupId])).toBe(0);
    expect(
      await count('group_activity_log', "group_id = $1 and action = 'expense_deleted'", [
        w.groupId,
      ]),
    ).toBe(1);
  });

  it('still deletes the payer movement of a non-adopted expense', async () => {
    const w = await newWorld(true);
    const [category] = await groupsRepo.listCategories(w.groupId);
    const saved = await repository.saveExpense({
      ...sendOf(w, randomUUID()),
      categoryId: category?.id ?? null,
      activity: {
        action: 'expense_created',
        memberId: w.anaMember,
        createdAt: NOW,
        fromMovement: false,
      },
      adoptedMovement: null,
      payerMovement: {
        userId: w.ana,
        accountId: w.accountId,
        categoryId: w.personalCategoryId,
        amount: 4_000_000n,
        occurredAt: new Date(NOW.getTime() - HOUR),
        note: 'Nota propia',
        rateType: 'mep',
      },
    });
    const movementId = saved.payerMovementId ?? '';
    expect(await movementRow(movementId)).toBeDefined();

    await repository.deleteExpense({
      groupId: w.groupId,
      expenseId: saved.id,
      baseVersion: 1,
      rateType: 'mep',
      activity: {
        action: 'expense_deleted',
        memberId: w.anaMember,
        createdAt: LATER,
        before: snapshotOf(w, 4_000_000n, new Date(NOW.getTime() - HOUR), saved.categoryId),
        after: null,
      },
    });

    expect(await movementRow(movementId)).toBeUndefined();
  });

  it('keeps the expense with a null link when its movement is deleted, and a later delete touches no movement', async () => {
    const w = await newWorld();
    const movementId = await newMovementRow(w);
    const other = await newMovementRow(w, 777n);
    const saved = await repository.saveExpense(sendOf(w, movementId));
    await connection.pool.query('delete from movements where id = $1', [movementId]);

    const row = await connection.pool.query<{
      payer_movement_id: string | null;
      adopted_movement: boolean;
    }>('select payer_movement_id, adopted_movement from group_expenses where id = $1', [saved.id]);
    expect(row.rows).toEqual([{ payer_movement_id: null, adopted_movement: true }]);

    await repository.deleteExpense({
      groupId: w.groupId,
      expenseId: saved.id,
      baseVersion: 1,
      rateType: 'mep',
      activity: {
        action: 'expense_deleted',
        memberId: w.anaMember,
        createdAt: LATER,
        before: snapshotOf(w, 4_000_000n, new Date(NOW.getTime() - HOUR), saved.categoryId),
        after: null,
      },
    });
    expect(await movementRow(other)).toBeDefined();
  });
});

describe('personal view', () => {
  it('counts the share of the payer and a receivable for the rest, the amount once', async () => {
    const w = await newWorld(true);
    const movementId = await newMovementRow(w, 40_000n);
    const saved = await repository.saveExpense(
      sendOf(
        w,
        movementId,
        {
          shares: [
            { memberId: w.anaMember, amount: 10_000n, basisPoints: null },
            { memberId: w.beaMember, amount: 30_000n, basisPoints: null },
          ],
        },
        40_000n,
      ),
    );

    const page = await repository.listPersonalShares(w.ana, { limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      expenseId: saved.id,
      shareAmount: 10_000n,
      receivableAmount: 30_000n,
    });
    expect(await count('movements', 'owner_id = $1', [w.ana])).toBe(1);
  });
});

describe('activity log', () => {
  it('reports fromMovement and autoCategory per entry', async () => {
    const w = await newWorld();
    await repository.saveExpense(sendOf(w, await newMovementRow(w)));

    const page = await new DrizzleActivityLogReader(connection.db).list(w.groupId, { limit: 10 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ fromMovement: true, autoCategory: 'created' });
  });
});

describe('payer recorder reads', () => {
  it('peeks and locks a movement, null for another owner, and flags the link', async () => {
    const w = await newWorld(true);
    const movementId = await newMovementRow(w);

    const peek = await recorder.peekAdoptable(w.ana, movementId);
    expect(peek).toMatchObject({
      id: movementId,
      type: 'expense',
      amount: 4_000_000n,
      currency: 'ARS',
      note: 'Nota propia',
      linked: false,
    });
    expect(await recorder.peekAdoptable(w.beaUser, movementId)).toBeNull();
    expect(await recorder.peekAdoptable(w.ana, randomUUID())).toBeNull();

    await repository.saveExpense(sendOf(w, movementId));
    expect((await recorder.peekAdoptable(w.ana, movementId))?.linked).toBe(true);
    const locked = await connection.db.transaction((tx) =>
      recorder.lockForAdoption(tx, w.ana, movementId),
    );
    expect(locked?.linked).toBe(true);
  });
});
