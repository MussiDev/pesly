import { randomUUID } from 'node:crypto';
import type {
  DefaultSplit,
  GroupExpense,
  GroupExpensePageResult,
  GroupExpenseRepository,
  ListExpensesQuery,
  ListPersonalSharesQuery,
  NewGroupExpense,
  PayerAccountCheck,
  PayerMovementRecorder,
  PayerMovementToRecord,
  PersonalSharesPageResult,
  PersonalShare,
} from '../../src/groups';
import type { InMemoryGroupRepository } from './fakes';

/** The fake "transaction": what the repository stages and only commits when the write succeeds. */
export interface FakeUnitOfWork {
  movements: RecordedMovement[];
}

export interface RecordedMovement extends PayerMovementToRecord {
  id: string;
}

interface FakeAccount {
  userId: string;
  currency: 'ARS' | 'USD';
}

interface FakeCategory {
  userId: string;
  kind: 'expense' | 'income';
}

export class InMemoryPayerMovementRecorder implements PayerMovementRecorder<FakeUnitOfWork> {
  readonly accounts = new Map<string, FakeAccount>();
  readonly categories = new Map<string, FakeCategory>();
  /** Committed movements only. */
  readonly movements: RecordedMovement[] = [];

  seedAccount(userId: string, currency: 'ARS' | 'USD'): string {
    const id = randomUUID();
    this.accounts.set(id, { userId, currency });
    return id;
  }

  seedCategory(userId: string, kind: 'expense' | 'income' = 'expense'): string {
    const id = randomUUID();
    this.categories.set(id, { userId, kind });
    return id;
  }

  async isUsable(check: PayerAccountCheck): Promise<boolean> {
    await Promise.resolve();
    const account = this.accounts.get(check.accountId);
    const category = this.categories.get(check.categoryId);
    return (
      account !== undefined &&
      category !== undefined &&
      account.userId === check.userId &&
      account.currency === check.currency &&
      category.userId === check.userId &&
      category.kind === 'expense'
    );
  }

  async record(unit: FakeUnitOfWork, movement: PayerMovementToRecord): Promise<{ id: string }> {
    await Promise.resolve();
    const recorded: RecordedMovement = { ...movement, id: randomUUID() };
    unit.movements.push(recorded);
    return { id: recorded.id };
  }

  /** Account balance as derived from committed movements (an expense lowers it). */
  spentOn(accountId: string): bigint {
    return this.movements
      .filter((m) => m.accountId === accountId)
      .reduce((total, m) => total + m.amount, 0n);
  }
}

export interface ActivityRow {
  id: string;
  groupId: string;
  memberId: string;
  action: 'expense_created' | 'settlement_created';
  subjectId: string;
  createdAt: Date;
}

function encodeCursor(occurredAt: Date, id: string): string {
  return `${occurredAt.toISOString()}|${id}`;
}

function afterCursor(occurredAt: Date, id: string, cursor: string | undefined): boolean {
  if (cursor === undefined) return true;
  const [at, cursorId] = cursor.split('|');
  const time = new Date(at ?? '').getTime();
  if (occurredAt.getTime() !== time) return occurredAt.getTime() < time;
  return id < (cursorId ?? '');
}

function newestFirst(a: GroupExpense, b: GroupExpense): number {
  const byTime = b.occurredAt.getTime() - a.occurredAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : -1;
}

/** Same contract as the Drizzle adapter; the transaction is simulated by staging then committing. */
export class InMemoryGroupExpenseRepository implements GroupExpenseRepository {
  readonly expenses: GroupExpense[] = [];
  readonly activity: ActivityRow[] = [];
  readonly defaultSplits = new Map<string, DefaultSplit>();
  /** When set, the write fails after the movement was staged (atomicity test). */
  failAfterMovement = false;

  constructor(
    private readonly groups: InMemoryGroupRepository,
    private readonly recorder: InMemoryPayerMovementRecorder,
  ) {}

  async saveExpense(data: NewGroupExpense): Promise<GroupExpense> {
    const unit: FakeUnitOfWork = { movements: [] };
    let payerMovementId: string | null = null;
    if (data.payerMovement !== null) {
      payerMovementId = (await this.recorder.record(unit, data.payerMovement)).id;
    }
    if (this.failAfterMovement) throw new Error('forced failure');
    const expense: GroupExpense = {
      id: randomUUID(),
      groupId: data.groupId,
      payerMemberId: data.payerMemberId,
      createdByMemberId: data.createdByMemberId,
      amount: data.amount,
      currency: data.currency,
      occurredAt: data.occurredAt,
      categoryId: data.categoryId,
      description: data.description,
      splitMode: data.splitMode,
      payerMovementId,
      createdAt: data.activity.createdAt,
      shares: data.shares.map((share) => ({ ...share })),
    };
    this.expenses.push(expense);
    this.activity.push({
      id: randomUUID(),
      groupId: data.groupId,
      memberId: data.activity.memberId,
      action: data.activity.action,
      subjectId: expense.id,
      createdAt: data.activity.createdAt,
    });
    this.recorder.movements.push(...unit.movements);
    return expense;
  }

  async listExpenses(groupId: string, query: ListExpensesQuery): Promise<GroupExpensePageResult> {
    await Promise.resolve();
    const all = this.expenses
      .filter((e) => e.groupId === groupId)
      .sort(newestFirst)
      .filter((e) => afterCursor(e.occurredAt, e.id, query.cursor));
    const items = all.slice(0, query.limit);
    const last = items[items.length - 1];
    const nextCursor =
      all.length > query.limit && last !== undefined
        ? encodeCursor(last.occurredAt, last.id)
        : null;
    return { items, nextCursor };
  }

  async getExpense(groupId: string, expenseId: string): Promise<GroupExpense | null> {
    await Promise.resolve();
    return this.expenses.find((e) => e.groupId === groupId && e.id === expenseId) ?? null;
  }

  async listPersonalShares(
    userId: string,
    query: ListPersonalSharesQuery,
  ): Promise<PersonalSharesPageResult> {
    await Promise.resolve();
    const own = new Set(this.groups.members.filter((m) => m.userId === userId).map((m) => m.id));
    const rows = this.expenses
      .filter((e) => query.from === undefined || e.occurredAt >= query.from)
      .filter((e) => query.to === undefined || e.occurredAt <= query.to)
      .filter((e) => own.has(e.payerMemberId) || e.shares.some((share) => own.has(share.memberId)))
      .sort(newestFirst)
      .filter((e) => afterCursor(e.occurredAt, e.id, query.cursor));
    const page = rows.slice(0, query.limit);
    const items: PersonalShare[] = page.map((e) => {
      const shareAmount = e.shares
        .filter((share) => own.has(share.memberId))
        .reduce((total, share) => total + share.amount, 0n);
      return {
        expenseId: e.id,
        groupId: e.groupId,
        currency: e.currency,
        occurredAt: e.occurredAt,
        shareAmount,
        receivableAmount: own.has(e.payerMemberId) ? e.amount - shareAmount : null,
      };
    });
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > query.limit && last !== undefined
        ? encodeCursor(last.occurredAt, last.id)
        : null;
    return { items, nextCursor };
  }

  async getDefaultSplit(groupId: string): Promise<DefaultSplit> {
    await Promise.resolve();
    return this.defaultSplits.get(groupId) ?? { mode: 'equal' };
  }

  async setDefaultSplit(groupId: string, split: DefaultSplit): Promise<DefaultSplit> {
    await Promise.resolve();
    this.defaultSplits.set(groupId, split);
    return split;
  }
}
