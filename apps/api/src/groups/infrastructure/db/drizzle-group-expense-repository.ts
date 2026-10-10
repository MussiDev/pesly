import { and, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import { violatedConstraint } from '../../../shared/db/pg-errors';
import type {
  GroupExpensePageResult,
  GroupExpenseRepository,
  ListExpensesQuery,
  ListPersonalSharesQuery,
  NewGroupExpense,
  PersonalSharesPageResult,
} from '../../application/ports/group-expense-repository';
import type { PayerMovementRecorder } from '../../application/ports/payer-movement-recorder';
import {
  ExpenseAmountNotPositive,
  GroupExpenseCategoryInvalid,
  GroupSplitMemberInvalid,
  type DefaultSplit,
  type GroupExpense,
  type GroupExpenseShare,
  type PersonalShare,
} from '../../domain/group-expense';
import { allActiveMembers, lockGroup } from './group-locks';
import { decodeCursor, pageOf, type Cursor } from './keyset-cursor';
import {
  groupActivityLog,
  groupDefaultSplitShares,
  groupExpenseShares,
  groupExpenses,
  groupMembers,
  groups,
} from './schema';

/** The transaction handle drizzle passes to the callback of `Database.transaction`. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const CHECK_VIOLATION = '23514';
const MEMBER_KEYS: readonly (string | undefined)[] = [
  'group_expenses_payer_group_fk',
  'group_expenses_creator_group_fk',
  'group_expense_shares_member_group_fk',
  'group_activity_log_member_group_fk',
  'group_default_split_shares_member_group_fk',
];
const CATEGORY_KEY = 'group_expenses_category_id_group_categories_id_fk';
const AMOUNT_CHECK = 'group_expenses_amount_check';

const expenseColumns = {
  id: groupExpenses.id,
  groupId: groupExpenses.groupId,
  payerMemberId: groupExpenses.payerMemberId,
  createdByMemberId: groupExpenses.createdByMemberId,
  amount: groupExpenses.amount,
  currency: groupExpenses.currency,
  occurredAt: groupExpenses.occurredAt,
  categoryId: groupExpenses.categoryId,
  description: groupExpenses.description,
  splitMode: groupExpenses.splitMode,
  payerMovementId: groupExpenses.payerMovementId,
  createdAt: groupExpenses.createdAt,
};

type ExpenseRow = typeof groupExpenses.$inferSelect;

function checkViolation(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth <= 5 && current instanceof Error; depth += 1) {
    if (Reflect.get(current, 'code') === CHECK_VIOLATION) {
      const constraint: unknown = Reflect.get(current, 'constraint');
      return typeof constraint === 'string' ? constraint : undefined;
    }
    current = current.cause;
  }
  return undefined;
}

/** The violations a caller can cause become typed errors; anything else is rethrown as it is. */
function mapWriteError(error: unknown): unknown {
  const foreignKey = violatedConstraint(error, '23503');
  if (MEMBER_KEYS.includes(foreignKey)) return new GroupSplitMemberInvalid();
  if (foreignKey === CATEGORY_KEY) return new GroupExpenseCategoryInvalid();
  if (checkViolation(error) === AMOUNT_CHECK) return new ExpenseAmountNotPositive();
  return error;
}

function byMember(a: GroupExpenseShare, b: GroupExpenseShare): number {
  return a.memberId < b.memberId ? -1 : 1;
}

async function loadShares(
  db: Database | Tx,
  expenseIds: readonly string[],
): Promise<Map<string, GroupExpenseShare[]>> {
  const byExpense = new Map<string, GroupExpenseShare[]>();
  if (expenseIds.length === 0) return byExpense;
  const rows = await db
    .select({
      expenseId: groupExpenseShares.expenseId,
      memberId: groupExpenseShares.memberId,
      amount: groupExpenseShares.amount,
      basisPoints: groupExpenseShares.basisPoints,
    })
    .from(groupExpenseShares)
    .where(inArray(groupExpenseShares.expenseId, [...expenseIds]));
  for (const { expenseId, ...share } of rows) {
    const list = byExpense.get(expenseId);
    if (list) list.push(share);
    else byExpense.set(expenseId, [share]);
  }
  for (const list of byExpense.values()) list.sort(byMember);
  return byExpense;
}

function toExpense(row: ExpenseRow, shares: GroupExpenseShare[]): GroupExpense {
  return { ...row, shares };
}

/** Rows strictly after the cursor in `(occurred_at desc, id desc)` order. */
function afterCursor(cursor: Cursor | null): SQL | undefined {
  return cursor === null
    ? undefined
    : sql`(${groupExpenses.occurredAt}, ${groupExpenses.id}) < (${cursor.occurredAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`;
}

export class DrizzleGroupExpenseRepository implements GroupExpenseRepository {
  constructor(
    private readonly db: Database,
    private readonly recorder: PayerMovementRecorder<Tx>,
  ) {}

  async saveExpense(data: NewGroupExpense): Promise<GroupExpense> {
    try {
      return await this.db.transaction(async (tx) => {
        // Group lock first, then the members, like the settlement path (spec D10): an expense
        // never lands beside a settlement that is reading the balances, nor for a member who left.
        await lockGroup(tx, data.groupId, 'share');
        const involved = [
          data.payerMemberId,
          data.createdByMemberId,
          data.activity.memberId,
          ...data.shares.map((share) => share.memberId),
        ];
        if (!(await allActiveMembers(tx, data.groupId, involved))) {
          throw new GroupSplitMemberInvalid();
        }
        const [row] = await tx
          .insert(groupExpenses)
          .values({
            groupId: data.groupId,
            payerMemberId: data.payerMemberId,
            createdByMemberId: data.createdByMemberId,
            amount: data.amount,
            currency: data.currency,
            occurredAt: data.occurredAt,
            categoryId: data.categoryId,
            description: data.description,
            splitMode: data.splitMode,
            createdAt: data.activity.createdAt,
          })
          .returning(expenseColumns);
        if (!row) throw new Error('Inserting a group expense returned no row');
        if (data.shares.length > 0) {
          await tx.insert(groupExpenseShares).values(
            data.shares.map((share) => ({
              expenseId: row.id,
              groupId: data.groupId,
              memberId: share.memberId,
              amount: share.amount,
              basisPoints: share.basisPoints,
            })),
          );
        }
        await tx.insert(groupActivityLog).values({
          groupId: data.groupId,
          memberId: data.activity.memberId,
          action: data.activity.action,
          subjectId: row.id,
          createdAt: data.activity.createdAt,
        });
        let payerMovementId: string | null = null;
        if (data.payerMovement !== null) {
          payerMovementId = (await this.recorder.record(tx, data.payerMovement)).id;
          await tx
            .update(groupExpenses)
            .set({ payerMovementId })
            .where(eq(groupExpenses.id, row.id));
        }
        const shares = data.shares.map((share) => ({ ...share })).sort(byMember);
        return toExpense({ ...row, payerMovementId }, shares);
      });
    } catch (error) {
      throw mapWriteError(error);
    }
  }

  async listExpenses(groupId: string, query: ListExpensesQuery): Promise<GroupExpensePageResult> {
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
    const rows = await this.db
      .select(expenseColumns)
      .from(groupExpenses)
      .where(and(eq(groupExpenses.groupId, groupId), afterCursor(cursor)))
      .orderBy(desc(groupExpenses.occurredAt), desc(groupExpenses.id))
      .limit(query.limit + 1);
    const page = pageOf(rows, query.limit);
    const shares = await loadShares(
      this.db,
      page.items.map((row) => row.id),
    );
    return {
      items: page.items.map((row) => toExpense(row, shares.get(row.id) ?? [])),
      nextCursor: page.nextCursor,
    };
  }

  async getExpense(groupId: string, expenseId: string): Promise<GroupExpense | null> {
    const [row] = await this.db
      .select(expenseColumns)
      .from(groupExpenses)
      .where(and(eq(groupExpenses.groupId, groupId), eq(groupExpenses.id, expenseId)))
      .limit(1);
    if (!row) return null;
    const shares = await loadShares(this.db, [row.id]);
    return toExpense(row, shares.get(row.id) ?? []);
  }

  async listPersonalShares(
    userId: string,
    query: ListPersonalSharesQuery,
  ): Promise<PersonalSharesPageResult> {
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
    // A registered member has at most one row per group, so each expense appears once.
    const rows = await this.db
      .select({
        id: groupExpenses.id,
        groupId: groupExpenses.groupId,
        currency: groupExpenses.currency,
        occurredAt: groupExpenses.occurredAt,
        amount: groupExpenses.amount,
        shareAmount: sql<string>`coalesce(${groupExpenseShares.amount}, 0)::text`,
        isPayer: sql<boolean>`${groupExpenses.payerMemberId} = ${groupMembers.id}`,
      })
      .from(groupMembers)
      .innerJoin(groupExpenses, eq(groupExpenses.groupId, groupMembers.groupId))
      .leftJoin(
        groupExpenseShares,
        and(
          eq(groupExpenseShares.expenseId, groupExpenses.id),
          eq(groupExpenseShares.memberId, groupMembers.id),
        ),
      )
      .where(
        and(
          eq(groupMembers.userId, userId),
          or(
            eq(groupExpenses.payerMemberId, groupMembers.id),
            eq(groupExpenseShares.memberId, groupMembers.id),
          ),
          query.from === undefined ? undefined : gte(groupExpenses.occurredAt, query.from),
          query.to === undefined ? undefined : lte(groupExpenses.occurredAt, query.to),
          afterCursor(cursor),
        ),
      )
      .orderBy(desc(groupExpenses.occurredAt), desc(groupExpenses.id))
      .limit(query.limit + 1);
    const page = pageOf(rows, query.limit);
    const items: PersonalShare[] = page.items.map((row) => {
      const shareAmount = BigInt(row.shareAmount);
      return {
        expenseId: row.id,
        groupId: row.groupId,
        currency: row.currency,
        occurredAt: row.occurredAt,
        shareAmount,
        receivableAmount: row.isPayer ? row.amount - shareAmount : null,
      };
    });
    return { items, nextCursor: page.nextCursor };
  }

  async getDefaultSplit(groupId: string): Promise<DefaultSplit> {
    const [group] = await this.db
      .select({ mode: groups.defaultSplitMode })
      .from(groups)
      .where(eq(groups.id, groupId))
      .limit(1);
    if (!group || group.mode === 'equal') return { mode: 'equal' };
    const shares = await this.db
      .select({
        memberId: groupDefaultSplitShares.memberId,
        basisPoints: groupDefaultSplitShares.basisPoints,
      })
      .from(groupDefaultSplitShares)
      .where(eq(groupDefaultSplitShares.groupId, groupId));
    return { mode: 'percentage', shares };
  }

  async setDefaultSplit(groupId: string, split: DefaultSplit): Promise<DefaultSplit> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.update(groups).set({ defaultSplitMode: split.mode }).where(eq(groups.id, groupId));
        await tx
          .delete(groupDefaultSplitShares)
          .where(eq(groupDefaultSplitShares.groupId, groupId));
        if (split.mode === 'percentage' && split.shares.length > 0) {
          await tx.insert(groupDefaultSplitShares).values(
            split.shares.map((share) => ({
              groupId,
              memberId: share.memberId,
              basisPoints: share.basisPoints,
            })),
          );
        }
      });
    } catch (error) {
      throw mapWriteError(error);
    }
    return this.getDefaultSplit(groupId);
  }
}
