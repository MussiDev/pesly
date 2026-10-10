import { randomUUID } from 'node:crypto';
import { AppError, DEFAULT_CATEGORIES } from '@pesly/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ExpenseAmountNotPositive,
  GroupExpenseCategoryInvalid,
  GroupSplitMemberInvalid,
  type NewGroupExpense,
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
  bea: string;
  groupId: string;
  anaMember: string;
  beaMember: string;
  ghost: string;
  categoryId: string;
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
  // Bea joins through the invitation flow of 05a; a direct row keeps this test on the adapter.
  const beaRow = await connection.pool.query<{ id: string }>(
    'insert into group_members (group_id, user_id) values ($1, $2) returning id',
    [group.id, bea],
  );
  const anaMember = (await groupsRepo.findMember(group.id, ana))?.id ?? '';
  const [category] = await groupsRepo.listCategories(group.id);
  return {
    ana,
    bea,
    groupId: group.id,
    anaMember,
    beaMember: beaRow.rows[0]?.id ?? '',
    ghost: ghostMember.id,
    categoryId: category?.id ?? '',
    accountId: await newAccount(connection.pool, ana, false, 'ARS'),
    personalCategoryId: await newCategory(connection.pool, ana, 'expense'),
  };
}

function equalShares(total: bigint, memberIds: string[]) {
  const each = total / BigInt(memberIds.length);
  let leftover = total - each * BigInt(memberIds.length);
  return memberIds.map((memberId) => {
    const extra = leftover > 0n ? 1n : 0n;
    leftover -= extra;
    return { memberId, amount: each + extra, basisPoints: null };
  });
}

function expenseOf(
  w: World,
  overrides: Partial<NewGroupExpense> & { members?: string[] } = {},
): NewGroupExpense {
  const { members, ...rest } = overrides;
  const amount = rest.amount ?? 4_000_000n;
  return {
    groupId: w.groupId,
    payerMemberId: w.anaMember,
    createdByMemberId: w.anaMember,
    amount,
    currency: 'ARS',
    occurredAt: new Date(NOW.getTime() - HOUR),
    categoryId: w.categoryId,
    description: 'Supermercado',
    splitMode: 'equal',
    shares: equalShares(amount, members ?? [w.anaMember, w.beaMember, w.ghost]),
    activity: { action: 'expense_created', memberId: w.anaMember, createdAt: NOW },
    payerMovement: null,
    ...rest,
  };
}

function movementOf(w: World, amount = 4_000_000n) {
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

async function count(table: string, where = 'true', params: unknown[] = []): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(
    `select count(*) as n from ${table} where ${where}`,
    params,
  );
  return Number(result.rows[0]?.n);
}

describe('saveExpense', () => {
  it('persists the expense, its shares and the log row together and reads them back', async () => {
    const w = await newWorld();

    const saved = await repository.saveExpense(expenseOf(w));

    expect(saved).toMatchObject({
      groupId: w.groupId,
      amount: 4_000_000n,
      currency: 'ARS',
      description: 'Supermercado',
      splitMode: 'equal',
      payerMovementId: null,
    });
    expect(saved.shares.reduce((sum, s) => sum + s.amount, 0n)).toBe(4_000_000n);
    expect(saved.shares).toHaveLength(3);
    const read = await repository.getExpense(w.groupId, saved.id);
    expect(read).toEqual(saved);
    const log = await connection.pool.query<{
      member_id: string;
      action: string;
      subject_id: string;
      created_at: Date;
    }>('select * from group_activity_log where group_id = $1', [w.groupId]);
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]).toMatchObject({
      member_id: w.anaMember,
      action: 'expense_created',
      subject_id: saved.id,
    });
    expect(log.rows[0]?.created_at.toISOString()).toBe(NOW.toISOString());
  });

  it('records the payer movement in the same write and lowers the derived balance by the full amount', async () => {
    const w = await newWorld();

    const saved = await repository.saveExpense(expenseOf(w, { payerMovement: movementOf(w) }));

    expect(saved.payerMovementId).not.toBeNull();
    const stored = await connection.pool.query<{ payer_movement_id: string }>(
      'select payer_movement_id from group_expenses where id = $1',
      [saved.id],
    );
    expect(stored.rows[0]?.payer_movement_id).toBe(saved.payerMovementId);
    const balance = await connection.pool.query<{ balance: string }>(
      `select (a.opening_balance - coalesce(sum(m.amount) filter (where m.type = 'expense'), 0))::text as balance
       from accounts a left join movements m on m.account_id = a.id where a.id = $1 group by a.id`,
      [w.accountId],
    );
    expect(balance.rows[0]?.balance).toBe('-4000000');
  });

  it('leaves nothing behind when the write fails after the movement insert', async () => {
    const w = await newWorld();
    const failing = new DrizzleGroupExpenseRepository(connection.db, {
      isUsable: (check) => recorder.isUsable(check),
      record: async (tx, movement) => {
        await recorder.record(tx, movement);
        throw new Error('forced failure');
      },
    });

    await expect(
      failing.saveExpense(expenseOf(w, { payerMovement: movementOf(w) })),
    ).rejects.toThrow('forced failure');

    expect(await count('group_expenses')).toBe(0);
    expect(await count('group_expense_shares')).toBe(0);
    expect(await count('group_activity_log')).toBe(0);
    expect(await count('movements')).toBe(0);
  });

  it('leaves no movement and a null payer_movement_id for a ghost payer', async () => {
    const w = await newWorld();

    const saved = await repository.saveExpense(
      expenseOf(w, { payerMemberId: w.ghost, payerMovement: null }),
    );

    expect(saved.payerMovementId).toBeNull();
    expect(await count('movements')).toBe(0);
  });

  it('maps a check, a foreign key on members and a foreign key on the category to typed errors (sad path)', async () => {
    const w = await newWorld();
    const other = await newWorld();

    await expect(
      repository.saveExpense(expenseOf(w, { amount: 0n, shares: [] })),
    ).rejects.toBeInstanceOf(ExpenseAmountNotPositive);
    await expect(
      repository.saveExpense(expenseOf(w, { payerMemberId: other.anaMember })),
    ).rejects.toBeInstanceOf(GroupSplitMemberInvalid);
    await expect(
      repository.saveExpense(expenseOf(w, { members: [w.anaMember, other.beaMember] })),
    ).rejects.toBeInstanceOf(GroupSplitMemberInvalid);
    await expect(
      repository.saveExpense(expenseOf(w, { categoryId: randomUUID() })),
    ).rejects.toBeInstanceOf(GroupExpenseCategoryInvalid);
    expect(await count('group_expenses')).toBe(0);
    expect(await count('group_activity_log')).toBe(0);
  });

  it('rethrows any other database failure as it is, without turning it into a typed error (sad path)', async () => {
    const w = await newWorld();

    const failure: unknown = await repository
      .saveExpense(expenseOf(w, { description: 'x'.repeat(201) }))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AppError);
    expect(await count('group_expenses')).toBe(0);
  });

  it('keeps every share sum equal to its amount across 20 concurrent creations', async () => {
    const w = await newWorld();

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        repository.saveExpense(
          expenseOf(w, { amount: 1_000_001n + BigInt(index), description: `Gasto ${index}` }),
        ),
      ),
    );

    const mismatched = await connection.pool.query(
      `select e.id from group_expenses e
       join group_expense_shares s on s.expense_id = e.id
       group by e.id, e.amount having sum(s.amount) <> e.amount`,
    );
    expect(mismatched.rows).toHaveLength(0);
    expect(await count('group_expenses')).toBe(20);
    expect(await count('group_expense_shares')).toBe(60);
    expect(await count('group_activity_log')).toBe(20);
  });
});

describe('getExpense', () => {
  it('does not find an expense of another group by its id (sad path)', async () => {
    const w = await newWorld();
    const other = await newWorld();
    const saved = await repository.saveExpense(expenseOf(w));

    expect(await repository.getExpense(other.groupId, saved.id)).toBeNull();
    expect(await repository.getExpense(w.groupId, randomUUID())).toBeNull();
  });
});

describe('listExpenses', () => {
  it('returns each expense once across pages, newest first, with an opaque cursor', async () => {
    const w = await newWorld();
    const sameInstant = new Date(NOW.getTime() - 5 * HOUR);
    const dates = [1, 2, 3, 4, 5].map((h) => new Date(NOW.getTime() - h * HOUR));
    dates[4] = sameInstant;
    dates[3] = sameInstant;
    const saved = [];
    for (const [index, occurredAt] of dates.entries()) {
      saved.push(
        await repository.saveExpense(expenseOf(w, { occurredAt, description: `G${index}` })),
      );
    }
    await repository.saveExpense(expenseOf(await newWorld()));

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await repository.listExpenses(w.groupId, {
        limit: 2,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...page.items.map((e) => e.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined);

    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    const expected = [...saved].sort(
      (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || (a.id < b.id ? 1 : -1),
    );
    expect(seen).toEqual(expected.map((e) => e.id));
    const first = await repository.listExpenses(w.groupId, { limit: 2 });
    expect(first.items[0]?.shares).toHaveLength(3);
  });

  it('answers a validation error for a cursor it did not produce (sad path)', async () => {
    const w = await newWorld();

    for (const cursor of [
      'not-a-cursor',
      'e30',
      Buffer.from('{"at":"x","id":"y"}').toString('base64url'),
    ]) {
      const failure: unknown = await repository
        .listExpenses(w.groupId, { limit: 10, cursor })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AppError);
      expect(failure).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
  });
});

describe('listPersonalShares', () => {
  it('gives the payer the share and the receivable, the others only the share, and nothing of other groups', async () => {
    const w = await newWorld();
    const stranger = await newWorld();
    const lola = await groupsRepo.addGhost({ groupId: w.groupId, displayName: 'Lola', limit: 50 });
    const saved = await repository.saveExpense(
      expenseOf(w, { members: [w.anaMember, w.beaMember, w.ghost, lola.id] }),
    );
    await repository.saveExpense(expenseOf(stranger));

    const ana = await repository.listPersonalShares(w.ana, { limit: 10 });
    const bea = await repository.listPersonalShares(w.bea, { limit: 10 });
    const nobody = await repository.listPersonalShares(await newUserId(connection.db), {
      limit: 10,
    });

    expect(ana.items).toEqual([
      {
        expenseId: saved.id,
        groupId: w.groupId,
        currency: 'ARS',
        occurredAt: saved.occurredAt,
        shareAmount: 1_000_000n,
        receivableAmount: 3_000_000n,
      },
    ]);
    expect(bea.items).toHaveLength(1);
    expect(bea.items[0]).toMatchObject({ shareAmount: 1_000_000n, receivableAmount: null });
    expect(nobody.items).toEqual([]);
  });

  it('gives a payer outside the split a share of 0 and the whole amount as receivable', async () => {
    const w = await newWorld();
    await repository.saveExpense(expenseOf(w, { members: [w.beaMember, w.ghost] }));

    const ana = await repository.listPersonalShares(w.ana, { limit: 10 });

    expect(ana.items[0]).toMatchObject({ shareAmount: 0n, receivableAmount: 4_000_000n });
  });

  it('filters by from and to, and pages without repeating', async () => {
    const w = await newWorld();
    for (const days of [1, 2, 3]) {
      await repository.saveExpense(
        expenseOf(w, { occurredAt: new Date(NOW.getTime() - days * 24 * HOUR) }),
      );
    }

    const ranged = await repository.listPersonalShares(w.ana, {
      limit: 10,
      from: new Date(NOW.getTime() - 2.5 * 24 * HOUR),
      to: new Date(NOW.getTime() - 1.5 * 24 * HOUR),
    });
    const first = await repository.listPersonalShares(w.ana, { limit: 2 });
    const second = await repository.listPersonalShares(w.ana, {
      limit: 2,
      ...(first.nextCursor === null ? {} : { cursor: first.nextCursor }),
    });

    expect(ranged.items).toHaveLength(1);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((i) => i.expenseId);
    expect(new Set(ids).size).toBe(3);
  });

  it('shows the claiming user the ghost expenses and shares after claimGhost', async () => {
    const w = await newWorld();
    const first = await repository.saveExpense(expenseOf(w, { members: [w.anaMember, w.ghost] }));
    const second = await repository.saveExpense(
      expenseOf(w, {
        payerMemberId: w.ghost,
        members: [w.ghost, w.beaMember],
        amount: 3_000_001n,
      }),
    );
    const carla = await newUserId(connection.db);
    await groupsRepo.replaceClaimLink({
      groupId: w.groupId,
      memberId: w.ghost,
      tokenHash: 'a'.repeat(64),
    });
    expect(await repository.listPersonalShares(carla, { limit: 10 })).toEqual({
      items: [],
      nextCursor: null,
    });

    await groupsRepo.claimGhost({ tokenHash: 'a'.repeat(64), userId: carla, now: NOW });

    const view = await repository.listPersonalShares(carla, { limit: 10 });
    expect(view.items.map((i) => i.expenseId).sort()).toEqual([first.id, second.id].sort());
    const asPayer = view.items.find((i) => i.expenseId === second.id);
    expect(asPayer).toMatchObject({ shareAmount: 1_500_001n, receivableAmount: 1_500_000n });
    const asMember = view.items.find((i) => i.expenseId === first.id);
    expect(asMember).toMatchObject({ shareAmount: 2_000_000n, receivableAmount: null });
  });

  it('lists the shares of both member rows of a user who left at balance 0 and rejoined, each once', async () => {
    const w = await newWorld();
    const before = await repository.saveExpense(
      expenseOf(w, {
        payerMemberId: w.beaMember,
        members: [w.beaMember],
        amount: 1_000_000n,
      }),
    );
    await groupsRepo.removeMember({ groupId: w.groupId, memberId: w.beaMember, leftAt: NOW });
    const rejoined = await connection.pool.query<{ id: string }>(
      'insert into group_members (group_id, user_id) values ($1, $2) returning id',
      [w.groupId, w.bea],
    );
    const newRow = rejoined.rows[0]?.id ?? '';
    const after = await repository.saveExpense(expenseOf(w, { members: [w.anaMember, newRow] }));

    const view = await repository.listPersonalShares(w.bea, { limit: 10 });

    expect(view.items.map((i) => i.expenseId).sort()).toEqual([before.id, after.id].sort());
    expect(view.items.find((i) => i.expenseId === before.id)).toMatchObject({
      shareAmount: 1_000_000n,
      receivableAmount: 0n,
    });
    expect(view.items.find((i) => i.expenseId === after.id)).toMatchObject({
      shareAmount: 2_000_000n,
      receivableAmount: null,
    });
  });

  it('answers a validation error for an invalid cursor (sad path)', async () => {
    const w = await newWorld();

    await expect(
      repository.listPersonalShares(w.ana, { limit: 10, cursor: 'garbage' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('default split', () => {
  it('is equal by default and replaces the whole percentage split on every set', async () => {
    const w = await newWorld();
    expect(await repository.getDefaultSplit(w.groupId)).toEqual({ mode: 'equal' });

    await repository.setDefaultSplit(w.groupId, {
      mode: 'percentage',
      shares: [
        { memberId: w.anaMember, basisPoints: 6000 },
        { memberId: w.beaMember, basisPoints: 4000 },
      ],
    });
    const stored = await repository.getDefaultSplit(w.groupId);
    expect(stored.mode).toBe('percentage');
    expect(stored.mode === 'percentage' ? stored.shares : []).toHaveLength(2);
    expect(stored.mode === 'percentage' ? stored.shares : []).toContainEqual({
      memberId: w.anaMember,
      basisPoints: 6000,
    });

    await repository.setDefaultSplit(w.groupId, {
      mode: 'percentage',
      shares: [{ memberId: w.ghost, basisPoints: 10_000 }],
    });
    expect(await repository.getDefaultSplit(w.groupId)).toEqual({
      mode: 'percentage',
      shares: [{ memberId: w.ghost, basisPoints: 10_000 }],
    });

    await repository.setDefaultSplit(w.groupId, { mode: 'equal' });
    expect(await repository.getDefaultSplit(w.groupId)).toEqual({ mode: 'equal' });
    expect(await count('group_default_split_shares', 'group_id = $1', [w.groupId])).toBe(0);
  });

  it('rejects a member of another group and keeps the previous split (sad path)', async () => {
    const w = await newWorld();
    const other = await newWorld();
    await repository.setDefaultSplit(w.groupId, {
      mode: 'percentage',
      shares: [{ memberId: w.anaMember, basisPoints: 10_000 }],
    });

    await expect(
      repository.setDefaultSplit(w.groupId, {
        mode: 'percentage',
        shares: [{ memberId: other.anaMember, basisPoints: 10_000 }],
      }),
    ).rejects.toBeInstanceOf(GroupSplitMemberInvalid);

    expect(await repository.getDefaultSplit(w.groupId)).toEqual({
      mode: 'percentage',
      shares: [{ memberId: w.anaMember, basisPoints: 10_000 }],
    });
  });

  it('answers an invalid-member error for a member who left and keeps the previous split', async () => {
    const w = await newWorld();
    await repository.setDefaultSplit(w.groupId, {
      mode: 'percentage',
      shares: [{ memberId: w.anaMember, basisPoints: 10_000 }],
    });
    await groupsRepo.removeMember({ groupId: w.groupId, memberId: w.beaMember, leftAt: NOW });

    await expect(
      repository.setDefaultSplit(w.groupId, {
        mode: 'percentage',
        shares: [
          { memberId: w.anaMember, basisPoints: 5_000 },
          { memberId: w.beaMember, basisPoints: 5_000 },
        ],
      }),
    ).rejects.toBeInstanceOf(GroupSplitMemberInvalid);

    expect(await repository.getDefaultSplit(w.groupId)).toEqual({
      mode: 'percentage',
      shares: [{ memberId: w.anaMember, basisPoints: 10_000 }],
    });
  });
});
