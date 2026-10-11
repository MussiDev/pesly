import { randomUUID } from 'node:crypto';
import type { AccountCurrency } from '@pesly/shared';
import type {
  AccountBalances,
  LinkableAccount,
} from '../../src/goals/application/ports/account-balances';
import type { Clock } from '../../src/goals/application/ports/clock';
import type {
  GoalChanges,
  GoalRepository,
  NewGoal,
  RecordedEntry,
} from '../../src/goals/application/ports/goal-repository';
import type { UserTimeZone } from '../../src/goals/application/ports/user-time-zone';
import {
  GoalLimitReached,
  GoalLinkedToAccount,
  GoalProgressTooLarge,
  GoalWithdrawalExceedsProgress,
} from '../../src/goals/domain/errors';
import {
  MAX_GOAL_PROGRESS,
  MAX_GOALS,
  type Goal,
  type GoalEntry,
  type GoalEntryKind,
} from '../../src/goals/domain/goal';
import type { AccessScope } from '../../src/shared/access';

export { readScopeFor, writeScopeFor } from '../accounts/fakes';

export class FakeClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return this.current;
  }
}

export class FakeTimeZones implements UserTimeZone {
  zone = 'America/Argentina/Buenos_Aires';

  timeZoneOf(): Promise<string> {
    return Promise.resolve(this.zone);
  }
}

interface GoalRow {
  ownerId: string;
  goal: Goal;
  entries: GoalEntry[];
}

function sum(entries: readonly GoalEntry[]): bigint {
  return entries.reduce(
    (total, entry) => (entry.kind === 'contribution' ? total + entry.amount : total - entry.amount),
    0n,
  );
}

/** In-memory goals and entries: rows are visible only to their owner. */
export class InMemoryGoalRepository implements GoalRepository {
  readonly rows = new Map<string, GoalRow>();
  private tick = 0;

  private visible(scope: AccessScope, id: string): GoalRow | null {
    const row = this.rows.get(id);
    return row !== undefined && row.ownerId === scope.userId ? row : null;
  }

  private nextDate(): Date {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.tick++));
  }

  async create(scope: AccessScope<'write'>, data: NewGoal): Promise<Goal> {
    await Promise.resolve();
    const owned = [...this.rows.values()].filter((row) => row.ownerId === scope.userId);
    if (owned.length >= MAX_GOALS) throw new GoalLimitReached();
    const goal: Goal = {
      id: randomUUID(),
      name: data.name,
      targetAmount: data.targetAmount,
      currency: data.currency,
      targetDate: data.targetDate,
      accountId: data.accountId,
      createdAt: this.nextDate(),
    };
    this.rows.set(goal.id, { ownerId: scope.userId, goal, entries: [] });
    return goal;
  }

  async list(scope: AccessScope): Promise<Goal[]> {
    await Promise.resolve();
    return [...this.rows.values()]
      .filter((row) => row.ownerId === scope.userId)
      .map((row) => row.goal)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async findById(scope: AccessScope, id: string): Promise<Goal | null> {
    await Promise.resolve();
    return this.visible(scope, id)?.goal ?? null;
  }

  async update(
    scope: AccessScope<'write'>,
    id: string,
    changes: GoalChanges,
  ): Promise<Goal | null> {
    await Promise.resolve();
    const row = this.visible(scope, id);
    if (row === null) return null;
    row.goal = {
      ...row.goal,
      ...(changes.name === undefined ? {} : { name: changes.name }),
      ...(changes.targetAmount === undefined ? {} : { targetAmount: changes.targetAmount }),
      ...(changes.targetDate === undefined ? {} : { targetDate: changes.targetDate }),
    };
    return row.goal;
  }

  async delete(scope: AccessScope<'write'>, id: string): Promise<boolean> {
    await Promise.resolve();
    if (this.visible(scope, id) === null) return false;
    this.rows.delete(id);
    return true;
  }

  async progressOf(scope: AccessScope, goalIds: readonly string[]): Promise<Map<string, bigint>> {
    await Promise.resolve();
    const result = new Map<string, bigint>();
    for (const id of goalIds) {
      const row = this.visible(scope, id);
      if (row === null || row.goal.accountId !== null) continue;
      result.set(id, sum(row.entries));
    }
    return result;
  }

  async recordEntry(
    scope: AccessScope<'write'>,
    goalId: string,
    kind: GoalEntryKind,
    amount: bigint,
  ): Promise<RecordedEntry | null> {
    await Promise.resolve();
    const row = this.visible(scope, goalId);
    if (row === null) return null;
    if (row.goal.accountId !== null) throw new GoalLinkedToAccount();
    const progress = sum(row.entries);
    if (kind === 'withdrawal' && amount > progress) throw new GoalWithdrawalExceedsProgress();
    if (kind === 'contribution' && progress + amount > MAX_GOAL_PROGRESS) {
      throw new GoalProgressTooLarge();
    }
    const entry: GoalEntry = { id: randomUUID(), kind, amount, createdAt: this.nextDate() };
    row.entries.push(entry);
    return { entry, progress: kind === 'contribution' ? progress + amount : progress - amount };
  }

  async listEntries(
    scope: AccessScope,
    goalId: string,
    limit: number,
  ): Promise<GoalEntry[] | null> {
    await Promise.resolve();
    const row = this.visible(scope, goalId);
    if (row === null) return null;
    return [...row.entries].reverse().slice(0, limit);
  }
}

interface AccountRow {
  ownerId: string;
  currency: AccountCurrency;
  archived: boolean;
  balance: bigint;
}

/** In-memory accounts with a settable balance; counts every call so tests can assert none happened. */
export class FakeAccountBalances implements AccountBalances {
  readonly accounts = new Map<string, AccountRow>();
  calls = 0;

  add(ownerId: string, currency: AccountCurrency, balance = 0n, archived = false): string {
    const id = randomUUID();
    this.accounts.set(id, { ownerId, currency, archived, balance });
    return id;
  }

  setBalance(accountId: string, balance: bigint): void {
    const row = this.accounts.get(accountId);
    if (row === undefined) throw new Error('unknown account');
    row.balance = balance;
  }

  async findLinkable(scope: AccessScope, accountId: string): Promise<LinkableAccount | null> {
    await Promise.resolve();
    this.calls++;
    const row = this.accounts.get(accountId);
    if (row === undefined || row.ownerId !== scope.userId) return null;
    return { id: accountId, currency: row.currency, archived: row.archived };
  }

  async balancesOf(
    scope: AccessScope,
    accountIds: readonly string[],
  ): Promise<Map<string, bigint>> {
    await Promise.resolve();
    this.calls++;
    const result = new Map<string, bigint>();
    for (const id of accountIds) {
      const row = this.accounts.get(id);
      if (row !== undefined && row.ownerId === scope.userId) result.set(id, row.balance);
    }
    return result;
  }
}
