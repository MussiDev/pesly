import { MOVEMENT_AMOUNT_MAX_MINOR_UNITS } from '@pesly/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  GoalLimitReached,
  GoalLinkedToAccount,
  GoalProgressTooLarge,
  GoalWithdrawalExceedsProgress,
} from '../../src/goals/domain/errors';
import { MAX_GOALS } from '../../src/goals/domain/goal';
import { DrizzleGoalRepository } from '../../src/goals/infrastructure/db/drizzle-goal-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { ResourceNotFound } from '../../src/shared/access';
import { testDatabaseUrl } from '../helpers/test-database';
import { newAccount, newUserId, readScope, writeScope } from '../movements/db-fixtures';

let connection: DatabaseConnection;
let repository: DrizzleGoalRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  repository = new DrizzleGoalRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const newGoal = (name = 'Vacations', accountId: string | null = null) => ({
  name,
  targetAmount: 200_000n,
  currency: 'ARS' as const,
  targetDate: null,
  accountId,
});

async function ownerWithGoal(name = 'Vacations') {
  const userId = await newUserId(connection.db);
  const scope = await writeScope(userId);
  const goal = await repository.create(scope, newGoal(name));
  return { userId, scope, goal };
}

const countRows = async (table: string, ownerId: string): Promise<number> => {
  const result = await connection.pool.query<{ n: string }>(
    `select count(*) as n from ${table} where owner_id = $1`,
    [ownerId],
  );
  return Number(result.rows[0]?.n);
};

describe('DrizzleGoalRepository create / read / update', () => {
  it('stores and returns a goal, listed oldest first (AC-01)', async () => {
    const userId = await newUserId(connection.db);
    const scope = await writeScope(userId);
    const first = await repository.create(scope, {
      ...newGoal('First'),
      targetDate: '2026-12-31',
    });
    const second = await repository.create(scope, newGoal('Second'));

    expect(first).toMatchObject({
      name: 'First',
      targetAmount: 200_000n,
      currency: 'ARS',
      targetDate: '2026-12-31',
      accountId: null,
    });
    expect((await repository.list(scope)).map((goal) => goal.id)).toEqual([first.id, second.id]);
    expect(await repository.findById(scope, first.id)).toEqual(first);
  });

  it('updates only the given keys and removes the date with null (AC-13)', async () => {
    const { scope, goal } = await ownerWithGoal();
    await repository.update(scope, goal.id, { targetDate: '2027-01-31' });

    const renamed = await repository.update(scope, goal.id, { name: 'Trip', targetAmount: 5n });
    expect(renamed).toMatchObject({ name: 'Trip', targetAmount: 5n, targetDate: '2027-01-31' });

    const cleared = await repository.update(scope, goal.id, { targetDate: null });
    expect(cleared).toMatchObject({ name: 'Trip', targetDate: null });
  });

  it('links a goal to the own account and maps a foreign account to not found (AC-18)', async () => {
    const ana = await newUserId(connection.db);
    const bea = await newUserId(connection.db);
    const anaAccount = await newAccount(connection.pool, ana);
    const beaAccount = await newAccount(connection.pool, bea);
    const scope = await writeScope(ana);

    const linked = await repository.create(scope, newGoal('Linked', anaAccount));
    expect(linked.accountId).toBe(anaAccount);

    await expect(repository.create(scope, newGoal('Foreign', beaAccount))).rejects.toBeInstanceOf(
      ResourceNotFound,
    );
    expect(await countRows('goals', ana)).toBe(1);
  });

  it('rethrows an unknown database error untouched (sad path)', async () => {
    const userId = await newUserId(connection.db);
    const scope = await writeScope(userId);
    await expect(
      repository.create(scope, { ...newGoal(), targetAmount: 0n }),
    ).rejects.not.toBeInstanceOf(ResourceNotFound);
    expect(await countRows('goals', userId)).toBe(0);
  });
});

describe('DrizzleGoalRepository limit (D10)', () => {
  it('rejects the 101st goal and keeps 100', async () => {
    const userId = await newUserId(connection.db);
    const scope = await writeScope(userId);
    await connection.pool.query(
      `insert into goals (owner_id, name, target_amount, currency)
       select $1, 'G' || n, 1000, 'ARS' from generate_series(1, $2::int) n`,
      [userId, MAX_GOALS],
    );

    await expect(repository.create(scope, newGoal())).rejects.toBeInstanceOf(GoalLimitReached);
    expect(await countRows('goals', userId)).toBe(MAX_GOALS);
  });

  it('lets exactly one of two concurrent creates of the 100th goal succeed (AC-24)', async () => {
    const userId = await newUserId(connection.db);
    const scope = await writeScope(userId);
    await connection.pool.query(
      `insert into goals (owner_id, name, target_amount, currency)
       select $1, 'G' || n, 1000, 'ARS' from generate_series(1, $2::int) n`,
      [userId, MAX_GOALS - 1],
    );

    const results = await Promise.allSettled([
      repository.create(scope, newGoal('A')),
      repository.create(scope, newGoal('B')),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(GoalLimitReached);
    expect(await countRows('goals', userId)).toBe(MAX_GOALS);
  });
});

describe('DrizzleGoalRepository entries (D6)', () => {
  it('records contributions and withdrawals and returns the new progress (AC-05, AC-08)', async () => {
    const { scope, goal } = await ownerWithGoal();

    const first = await repository.recordEntry(scope, goal.id, 'contribution', 30_000n);
    await repository.recordEntry(scope, goal.id, 'contribution', 20_000n);
    const last = await repository.recordEntry(scope, goal.id, 'withdrawal', 10_000n);

    expect(first?.progress).toBe(30_000n);
    expect(last?.progress).toBe(40_000n);
    expect(last?.entry).toMatchObject({ kind: 'withdrawal', amount: 10_000n });
    expect((await repository.progressOf(scope, [goal.id])).get(goal.id)).toBe(40_000n);
  });

  it('allows a withdrawal equal to the progress and refuses one cent more (AC-06, AC-07)', async () => {
    const { scope, goal } = await ownerWithGoal();
    await repository.recordEntry(scope, goal.id, 'contribution', 10_000n);

    await expect(
      repository.recordEntry(scope, goal.id, 'withdrawal', 10_001n),
    ).rejects.toBeInstanceOf(GoalWithdrawalExceedsProgress);
    const drained = await repository.recordEntry(scope, goal.id, 'withdrawal', 10_000n);

    expect(drained?.progress).toBe(0n);
    expect(await countRows('goal_entries', scope.userId)).toBe(2);
  });

  it('lets exactly one of two concurrent withdrawals of 80.00 from 100.00 succeed (AC-07)', async () => {
    const { scope, goal } = await ownerWithGoal();
    await repository.recordEntry(scope, goal.id, 'contribution', 10_000n);

    const results = await Promise.allSettled([
      repository.recordEntry(scope, goal.id, 'withdrawal', 8_000n),
      repository.recordEntry(scope, goal.id, 'withdrawal', 8_000n),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
      GoalWithdrawalExceedsProgress,
    );
    expect((await repository.progressOf(scope, [goal.id])).get(goal.id)).toBe(2_000n);
  });

  it('refuses a contribution that pushes progress above the largest amount (NFR-01)', async () => {
    const { scope, goal } = await ownerWithGoal();
    await repository.recordEntry(scope, goal.id, 'contribution', MOVEMENT_AMOUNT_MAX_MINOR_UNITS);

    await expect(repository.recordEntry(scope, goal.id, 'contribution', 1n)).rejects.toBeInstanceOf(
      GoalProgressTooLarge,
    );
    expect((await repository.progressOf(scope, [goal.id])).get(goal.id)).toBe(
      MOVEMENT_AMOUNT_MAX_MINOR_UNITS,
    );
  });

  it('refuses an entry on a linked goal (AC-19)', async () => {
    const userId = await newUserId(connection.db);
    const scope = await writeScope(userId);
    const accountId = await newAccount(connection.pool, userId);
    const linked = await repository.create(scope, newGoal('Linked', accountId));

    await expect(
      repository.recordEntry(scope, linked.id, 'contribution', 1n),
    ).rejects.toBeInstanceOf(GoalLinkedToAccount);
    expect(await countRows('goal_entries', userId)).toBe(0);
  });

  it('lists entries newest first, at most the limit (AC-20)', async () => {
    const { scope, goal } = await ownerWithGoal();
    for (const amount of [1n, 2n, 3n]) {
      await repository.recordEntry(scope, goal.id, 'contribution', amount);
    }

    const entries = await repository.listEntries(scope, goal.id, 2);

    expect(entries?.map((entry) => entry.amount)).toEqual([3n, 2n]);
  });
});

describe('DrizzleGoalRepository progressOf', () => {
  it('groups three goals with mixed entries and omits linked goals (AC-08)', async () => {
    const userId = await newUserId(connection.db);
    const scope = await writeScope(userId);
    const accountId = await newAccount(connection.pool, userId);
    const a = await repository.create(scope, newGoal('A'));
    const b = await repository.create(scope, newGoal('B'));
    const c = await repository.create(scope, newGoal('C'));
    const linked = await repository.create(scope, newGoal('L', accountId));
    await repository.recordEntry(scope, a.id, 'contribution', 300n);
    await repository.recordEntry(scope, a.id, 'contribution', 200n);
    await repository.recordEntry(scope, a.id, 'withdrawal', 100n);
    await repository.recordEntry(scope, b.id, 'contribution', 7n);

    const progress = await repository.progressOf(scope, [a.id, b.id, c.id, linked.id]);

    expect(progress.get(a.id)).toBe(400n);
    expect(progress.get(b.id)).toBe(7n);
    expect(progress.has(linked.id)).toBe(false);
    expect(progress.get(c.id) ?? 0n).toBe(0n);
  });

  it('returns a goal with 1,000 entries from one statement (NFR-03)', async () => {
    const { scope, goal } = await ownerWithGoal();
    await connection.pool.query(
      `insert into goal_entries (goal_id, owner_id, kind, amount)
       select $1, $2, case when n % 10 = 0 then 'withdrawal' else 'contribution' end, 100
       from generate_series(1, 1000) n`,
      [goal.id, scope.userId],
    );
    const spy = vi.spyOn(connection.pool, 'query');

    const progress = await repository.progressOf(scope, [goal.id]);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(progress.get(goal.id)).toBe(80_000n);
  });

  it('answers an empty map for no ids without querying', async () => {
    const userId = await newUserId(connection.db);
    const scope = await writeScope(userId);

    expect((await repository.progressOf(scope, [])).size).toBe(0);
  });
});

describe('DrizzleGoalRepository delete (AC-14)', () => {
  it('removes the goal and its entries and leaves the account balance alone', async () => {
    const userId = await newUserId(connection.db);
    const scope = await writeScope(userId);
    const accountId = await newAccount(connection.pool, userId);
    const goal = await repository.create(scope, newGoal());
    await repository.recordEntry(scope, goal.id, 'contribution', 500n);
    const before = await connection.pool.query('select * from accounts where id = $1', [accountId]);

    expect(await repository.delete(scope, goal.id)).toBe(true);

    expect(await countRows('goals', userId)).toBe(0);
    expect(await countRows('goal_entries', userId)).toBe(0);
    const after = await connection.pool.query('select * from accounts where id = $1', [accountId]);
    expect(after.rows).toEqual(before.rows);
    expect(await repository.delete(scope, goal.id)).toBe(false);
  });
});

describe('DrizzleGoalRepository scoping (AC-15, AC-16)', () => {
  it("returns nothing for another owner's ids and changes nothing", async () => {
    const owner = await ownerWithGoal();
    await repository.recordEntry(owner.scope, owner.goal.id, 'contribution', 100n);
    const strangerId = await newUserId(connection.db);
    const stranger = await writeScope(strangerId);
    const strangerRead = await readScope(strangerId);

    expect(await repository.list(strangerRead)).toEqual([]);
    expect(await repository.findById(strangerRead, owner.goal.id)).toBeNull();
    expect(await repository.update(stranger, owner.goal.id, { name: 'Hacked' })).toBeNull();
    expect((await repository.progressOf(strangerRead, [owner.goal.id])).size).toBe(0);
    expect(await repository.recordEntry(stranger, owner.goal.id, 'contribution', 1n)).toBeNull();
    expect(await repository.listEntries(strangerRead, owner.goal.id, 10)).toBeNull();
    expect(await repository.delete(stranger, owner.goal.id)).toBe(false);

    expect(await repository.findById(owner.scope, owner.goal.id)).toMatchObject({
      name: 'Vacations',
    });
    expect(await countRows('goal_entries', owner.userId)).toBe(1);
  });
});
