import { AppError } from '@pesly/shared';
import { describe, expect, it } from 'vitest';
import { CreateGoal } from '../../src/goals/application/create-goal';
import { DeleteGoal } from '../../src/goals/application/delete-goal';
import { GetGoal } from '../../src/goals/application/get-goal';
import { ListGoalEntries } from '../../src/goals/application/list-goal-entries';
import { ListGoals } from '../../src/goals/application/list-goals';
import { RecordGoalEntry } from '../../src/goals/application/record-goal-entry';
import { UpdateGoal } from '../../src/goals/application/update-goal';
import { ResourceNotFound } from '../../src/shared/access';
import {
  FakeAccountBalances,
  FakeClock,
  FakeTimeZones,
  InMemoryGoalRepository,
  readScopeFor,
  writeScopeFor,
} from './fakes';

const ALICE = 'alice';
const BOB = 'bob';

function setup(now = new Date('2026-10-15T15:00:00Z')) {
  const goals = new InMemoryGoalRepository();
  const accounts = new FakeAccountBalances();
  const timeZones = new FakeTimeZones();
  const clock = new FakeClock(now);
  const deps = { goals, accounts, timeZones, clock };
  return {
    goals,
    accounts,
    clock,
    timeZones,
    create: new CreateGoal(deps),
    list: new ListGoals(deps),
    get: new GetGoal(deps),
    update: new UpdateGoal(deps),
    remove: new DeleteGoal(deps),
    record: new RecordGoalEntry(deps),
    entries: new ListGoalEntries(deps),
  };
}

const vacations = {
  name: 'Vacations',
  targetAmount: 200000n,
  currency: 'USD' as const,
  targetDate: '2026-12-31',
};

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

describe('create and list', () => {
  it('stores a goal and lists it (AC-01)', async () => {
    const t = setup();
    const scope = await writeScopeFor(ALICE);
    const created = await t.create.execute(scope, vacations);
    expect(created).toMatchObject({
      name: 'Vacations',
      targetAmount: 200000n,
      currency: 'USD',
      targetDate: '2026-12-31',
      accountId: null,
      progress: 0n,
      percentage: 0n,
      status: 'active',
    });
    const listed = await t.list.execute(await readScopeFor(ALICE));
    expect(listed.map((goal) => goal.id)).toEqual([created.id]);
  });

  it('rejects a target of 0 or less and an empty name (AC-02, AC-17)', async () => {
    const t = setup();
    const scope = await writeScopeFor(ALICE);
    await expectCode(
      t.create.execute(scope, { ...vacations, targetAmount: 0n }),
      'VALIDATION_FAILED',
    );
    await expectCode(
      t.create.execute(scope, { ...vacations, targetAmount: -1n }),
      'VALIDATION_FAILED',
    );
    await expectCode(t.create.execute(scope, { ...vacations, name: '   ' }), 'VALIDATION_FAILED');
    expect(t.goals.rows.size).toBe(0);
  });

  it('answers 409 for another currency and 404 for a foreign or missing account (AC-03, AC-18)', async () => {
    const t = setup();
    const scope = await writeScopeFor(ALICE);
    const ars = t.accounts.add(ALICE, 'ARS');
    const foreign = t.accounts.add(BOB, 'USD');
    await expectCode(
      t.create.execute(scope, { ...vacations, accountId: ars }),
      'GOAL_ACCOUNT_CURRENCY_MISMATCH',
    );
    expect(
      await rejection(t.create.execute(scope, { ...vacations, accountId: foreign })),
    ).toBeInstanceOf(ResourceNotFound);
    expect(
      await rejection(
        t.create.execute(scope, {
          ...vacations,
          accountId: '00000000-0000-4000-8000-000000000000',
        }),
      ),
    ).toBeInstanceOf(ResourceNotFound);
    expect(t.goals.rows.size).toBe(0);
  });

  it('refuses an archived account with ACCOUNT_ARCHIVED', async () => {
    const t = setup();
    const archived = t.accounts.add(ALICE, 'USD', 0n, true);
    await expectCode(
      t.create.execute(await writeScopeFor(ALICE), { ...vacations, accountId: archived }),
      'ACCOUNT_ARCHIVED',
    );
    expect(t.goals.rows.size).toBe(0);
  });

  it('rejects the 101st goal (AC-24)', async () => {
    const t = setup();
    const scope = await writeScopeFor(ALICE);
    for (let i = 0; i < 100; i++) await t.create.execute(scope, vacations);
    await expectCode(t.create.execute(scope, vacations), 'GOAL_LIMIT_REACHED');
    expect(t.goals.rows.size).toBe(100);
    // Another user is not affected by the first user's count.
    await t.create.execute(await writeScopeFor(BOB), vacations);
  });
});

describe('linked goals', () => {
  it('follows the account balance (AC-04)', async () => {
    const t = setup();
    const account = t.accounts.add(ALICE, 'USD', 50000n);
    const created = await t.create.execute(await writeScopeFor(ALICE), {
      ...vacations,
      accountId: account,
    });
    expect(created.progress).toBe(50000n);
    t.accounts.setBalance(account, 70000n);
    const read = await t.get.execute(await readScopeFor(ALICE), created.id);
    expect(read.progress).toBe(70000n);
    expect(read.percentage).toBe(35n);
  });

  it('shows a negative balance as progress with 0% (AC-21)', async () => {
    const t = setup();
    const account = t.accounts.add(ALICE, 'USD', -12000n);
    const created = await t.create.execute(await writeScopeFor(ALICE), {
      ...vacations,
      accountId: account,
    });
    expect(created.progress).toBe(-12000n);
    expect(created.percentage).toBe(0n);
  });

  it('refuses contributions and withdrawals and records nothing (AC-19)', async () => {
    const t = setup();
    const account = t.accounts.add(ALICE, 'USD', 50000n);
    const scope = await writeScopeFor(ALICE);
    const created = await t.create.execute(scope, { ...vacations, accountId: account });
    await expectCode(
      t.record.execute(scope, created.id, { kind: 'contribution', amount: 100n }),
      'GOAL_LINKED_TO_ACCOUNT',
    );
    await expectCode(
      t.record.execute(scope, created.id, { kind: 'withdrawal', amount: 100n }),
      'GOAL_LINKED_TO_ACCOUNT',
    );
    expect(await t.entries.execute(await readScopeFor(ALICE), created.id, 50)).toEqual([]);
  });
});

describe('entries', () => {
  async function unlinked(t: ReturnType<typeof setup>, user = ALICE) {
    return t.create.execute(await writeScopeFor(user), vacations);
  }

  it('a contribution raises progress and touches no account (AC-05)', async () => {
    const t = setup();
    const goal = await unlinked(t);
    const result = await t.record.execute(await writeScopeFor(ALICE), goal.id, {
      kind: 'contribution',
      amount: 20000n,
    });
    expect(result.goal.progress).toBe(20000n);
    expect(result.entry).toMatchObject({ kind: 'contribution', amount: 20000n });
    expect(t.accounts.calls).toBe(0);
  });

  it('withdraws part of the progress and exactly all of it (AC-06)', async () => {
    const t = setup();
    const goal = await unlinked(t);
    const scope = await writeScopeFor(ALICE);
    await t.record.execute(scope, goal.id, { kind: 'contribution', amount: 20000n });
    const partial = await t.record.execute(scope, goal.id, { kind: 'withdrawal', amount: 5000n });
    expect(partial.goal.progress).toBe(15000n);
    const all = await t.record.execute(scope, goal.id, { kind: 'withdrawal', amount: 15000n });
    expect(all.goal.progress).toBe(0n);
  });

  it('rejects a withdrawal above progress and records nothing (AC-07)', async () => {
    const t = setup();
    const goal = await unlinked(t);
    const scope = await writeScopeFor(ALICE);
    await t.record.execute(scope, goal.id, { kind: 'contribution', amount: 20000n });
    await expectCode(
      t.record.execute(scope, goal.id, { kind: 'withdrawal', amount: 20001n }),
      'GOAL_WITHDRAWAL_EXCEEDS_PROGRESS',
    );
    expect(await t.entries.execute(scope, goal.id, 50)).toHaveLength(1);
  });

  it('adds contributions and subtracts withdrawals (AC-08)', async () => {
    const t = setup();
    const goal = await unlinked(t);
    const scope = await writeScopeFor(ALICE);
    await t.record.execute(scope, goal.id, { kind: 'contribution', amount: 30000n });
    await t.record.execute(scope, goal.id, { kind: 'contribution', amount: 20000n });
    await t.record.execute(scope, goal.id, { kind: 'withdrawal', amount: 10000n });
    expect((await t.get.execute(scope, goal.id)).progress).toBe(40000n);
  });

  it('lists entries newest first within the limit', async () => {
    const t = setup();
    const goal = await unlinked(t);
    const scope = await writeScopeFor(ALICE);
    await t.record.execute(scope, goal.id, { kind: 'contribution', amount: 100n });
    await t.record.execute(scope, goal.id, { kind: 'contribution', amount: 200n });
    await t.record.execute(scope, goal.id, { kind: 'withdrawal', amount: 50n });
    const listed = await t.entries.execute(scope, goal.id, 2);
    expect(listed.map((entry) => entry.amount)).toEqual([50n, 200n]);
  });

  it('rejects a contribution that pushes progress above the largest amount (NFR-01)', async () => {
    const t = setup();
    const goal = await unlinked(t);
    const scope = await writeScopeFor(ALICE);
    await t.record.execute(scope, goal.id, {
      kind: 'contribution',
      amount: 9_999_999_999_999_999n,
    });
    await expectCode(
      t.record.execute(scope, goal.id, { kind: 'contribution', amount: 1n }),
      'GOAL_PROGRESS_TOO_LARGE',
    );
    expect((await t.get.execute(scope, goal.id)).progress).toBe(9_999_999_999_999_999n);
  });

  it('rejects an amount of 0 or less', async () => {
    const t = setup();
    const goal = await unlinked(t);
    const scope = await writeScopeFor(ALICE);
    await expectCode(
      t.record.execute(scope, goal.id, { kind: 'contribution', amount: 0n }),
      'VALIDATION_FAILED',
    );
    await expectCode(
      t.record.execute(scope, goal.id, { kind: 'withdrawal', amount: -5n }),
      'VALIDATION_FAILED',
    );
  });
});

describe('derived fields', () => {
  it('shows an integer floor percentage (AC-09)', async () => {
    const t = setup();
    const goal = await t.create.execute(await writeScopeFor(ALICE), vacations);
    const result = await t.record.execute(await writeScopeFor(ALICE), goal.id, {
      kind: 'contribution',
      amount: 50000n,
    });
    expect(result.goal.percentage).toBe(25n);
  });

  it('computes the monthly amount needed (AC-10, AC-25)', async () => {
    const t = setup();
    const scope = await writeScopeFor(ALICE);
    const goal = await t.create.execute(scope, vacations);
    const withProgress = await t.record.execute(scope, goal.id, {
      kind: 'contribution',
      amount: 50000n,
    });
    expect(withProgress.goal.monthlyAmountNeeded).toBe(50000n);
    const other = await t.create.execute(scope, { ...vacations, targetAmount: 100000n });
    expect(other.monthlyAmountNeeded).toBe(33334n);
  });

  it('counts the month in the user time zone (AC-26)', async () => {
    // 22:30 on 2026-10-31 in Buenos Aires is 01:30 on 2026-11-01 UTC.
    const t = setup(new Date('2026-11-01T01:30:00Z'));
    const scope = await writeScopeFor(ALICE);
    const goal = await t.create.execute(scope, vacations);
    const result = await t.record.execute(scope, goal.id, {
      kind: 'contribution',
      amount: 50000n,
    });
    expect(result.goal.monthlyAmountNeeded).toBe(50000n);
  });

  it('marks a past date overdue but not one due today (AC-11)', async () => {
    const t = setup();
    const scope = await writeScopeFor(ALICE);
    const yesterday = await t.create.execute(scope, { ...vacations, targetDate: '2026-10-14' });
    expect(yesterday).toMatchObject({ status: 'overdue', monthlyAmountNeeded: null });
    const today = await t.create.execute(scope, { ...vacations, targetDate: '2026-10-15' });
    expect(today.status).toBe('active');
  });

  it('marks a goal reached at or above the target (AC-12)', async () => {
    const t = setup();
    const scope = await writeScopeFor(ALICE);
    const goal = await t.create.execute(scope, vacations);
    const result = await t.record.execute(scope, goal.id, {
      kind: 'contribution',
      amount: 200000n,
    });
    expect(result.goal).toMatchObject({ status: 'reached', monthlyAmountNeeded: null });
  });
});

describe('update', () => {
  it('persists and recomputes the derived fields (AC-13)', async () => {
    const t = setup();
    const scope = await writeScopeFor(ALICE);
    const goal = await t.create.execute(scope, vacations);
    await t.record.execute(scope, goal.id, { kind: 'contribution', amount: 50000n });
    const updated = await t.update.execute(scope, goal.id, {
      name: 'Trip',
      targetAmount: 100000n,
      targetDate: '2026-11-30',
    });
    expect(updated).toMatchObject({
      name: 'Trip',
      targetAmount: 100000n,
      targetDate: '2026-11-30',
      percentage: 50n,
      monthlyAmountNeeded: 25000n,
    });
    expect((await t.get.execute(scope, goal.id)).name).toBe('Trip');
  });

  it('removes the date with null and may lower the target below progress', async () => {
    const t = setup();
    const scope = await writeScopeFor(ALICE);
    const goal = await t.create.execute(scope, vacations);
    await t.record.execute(scope, goal.id, { kind: 'contribution', amount: 50000n });
    const updated = await t.update.execute(scope, goal.id, {
      targetDate: null,
      targetAmount: 40000n,
    });
    expect(updated).toMatchObject({
      targetDate: null,
      status: 'reached',
      monthlyAmountNeeded: null,
    });
  });

  it('rejects an empty name or a target of 0 and leaves the goal unchanged (AC-22)', async () => {
    const t = setup();
    const scope = await writeScopeFor(ALICE);
    const goal = await t.create.execute(scope, vacations);
    await expectCode(t.update.execute(scope, goal.id, { name: '' }), 'VALIDATION_FAILED');
    await expectCode(t.update.execute(scope, goal.id, { targetAmount: 0n }), 'VALIDATION_FAILED');
    expect(await t.get.execute(scope, goal.id)).toMatchObject({
      name: 'Vacations',
      targetAmount: 200000n,
    });
  });
});

describe('delete', () => {
  it('removes the goal and its entries and calls no account port (AC-14)', async () => {
    const t = setup();
    const scope = await writeScopeFor(ALICE);
    const goal = await t.create.execute(scope, vacations);
    await t.record.execute(scope, goal.id, { kind: 'contribution', amount: 100n });
    const callsBefore = t.accounts.calls;
    await t.remove.execute(scope, goal.id);
    expect(t.goals.rows.size).toBe(0);
    expect(t.accounts.calls).toBe(callsBefore);
    expect(await rejection(t.get.execute(await readScopeFor(ALICE), goal.id))).toBeInstanceOf(
      ResourceNotFound,
    );
  });
});

describe('ownership', () => {
  it("answers 404 on another user's goal and changes nothing (AC-15, AC-16)", async () => {
    const t = setup();
    const goal = await t.create.execute(await writeScopeFor(ALICE), vacations);
    await t.create.execute(await writeScopeFor(BOB), { ...vacations, name: 'Bob goal' });
    const bobWrite = await writeScopeFor(BOB);
    const bobRead = await readScopeFor(BOB);

    const attempts = [
      t.get.execute(bobRead, goal.id),
      t.update.execute(bobWrite, goal.id, { name: 'Hacked' }),
      t.remove.execute(bobWrite, goal.id),
      t.record.execute(bobWrite, goal.id, { kind: 'contribution', amount: 100n }),
      t.entries.execute(bobRead, goal.id, 50),
    ];
    for (const attempt of attempts) {
      expect(await rejection(attempt)).toBeInstanceOf(ResourceNotFound);
    }
    expect(t.goals.rows.get(goal.id)?.goal.name).toBe('Vacations');
    expect(t.goals.rows.get(goal.id)?.entries).toHaveLength(0);
    expect((await t.list.execute(bobRead)).map((item) => item.name)).toEqual(['Bob goal']);
  });
});
