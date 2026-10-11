import { AppError, type AccountCurrency, type RateType } from '@pesly/shared';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { ResourceNotFound } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import { violatedConstraint } from '../../../shared/db/pg-errors';
import type {
  DeleteGroupSettlementData,
  GroupSettlementPageResult,
  GroupSettlementRepository,
  ListSettlementsPageQuery,
  NewGroupSettlement,
  UpdateGroupSettlementData,
} from '../../application/ports/group-settlement-repository';
import {
  isConsolidated,
  settlementChangedMembers,
  settlementSnapshot,
  type SettlementEffect,
} from '../../domain/group-change';
import {
  GroupRecordFormerMember,
  GroupSettlementAccountInvalid,
  GroupSettlementConsolidated,
  GroupSettlementMemberInvalid,
  GroupSettlementStale,
} from '../../domain/errors';
import {
  balancesByCurrency,
  pairLegs,
  SettlementAmountNotPositive,
  SettlementRateNotPositive,
  type BalanceSourcesByCurrency,
  type GroupSettlement,
  type SettlementLeg,
} from '../../domain/settlement';
import { allActiveMembers, lockGroup, type GroupTx } from './group-locks';
import { decodeCursor, pageOf, type Cursor } from './keyset-cursor';
import {
  groupActivityLog,
  groupExpenseShares,
  groupExpenses,
  groupSettlementLegs,
  groupSettlements,
} from './schema';

type Executor = Database | GroupTx;

const MEMBER_KEYS: readonly (string | undefined)[] = [
  'group_settlements_from_group_fk',
  'group_settlements_to_group_fk',
  'group_settlements_creator_group_fk',
  'group_settlements_account_member_group_fk',
  'group_activity_log_member_group_fk',
  'group_settlements_distinct_members_check',
];
const ACCOUNT_KEYS: readonly (string | undefined)[] = [
  'group_settlements_account_id_accounts_id_fk',
  'group_settlements_account_member_party_check',
];
const AMOUNT_KEYS: readonly (string | undefined)[] = [
  'group_settlements_amount_check',
  'group_settlements_amount_or_rate_check',
];
const RATE_KEY = 'group_settlements_rate_positive_check';
const LEG_KEYS: readonly (string | undefined)[] = [
  'group_settlement_legs_pkey',
  'group_settlement_legs_amount_check',
];

const settlementColumns = {
  id: groupSettlements.id,
  groupId: groupSettlements.groupId,
  fromMemberId: groupSettlements.fromMemberId,
  toMemberId: groupSettlements.toMemberId,
  currency: groupSettlements.currency,
  amount: groupSettlements.amount,
  occurredAt: groupSettlements.occurredAt,
  createdByMemberId: groupSettlements.createdByMemberId,
  accountId: groupSettlements.accountId,
  accountMemberId: groupSettlements.accountMemberId,
  rate: groupSettlements.rate,
  rateSource: groupSettlements.rateSource,
  rateType: groupSettlements.rateType,
  createdAt: groupSettlements.createdAt,
};

type SettlementRow = typeof groupSettlements.$inferSelect;

/** The violations a caller can cause become typed errors; anything else is rethrown as it is. */
function mapWriteError(error: unknown): unknown {
  const foreignKey = violatedConstraint(error, '23503');
  if (MEMBER_KEYS.includes(foreignKey)) return new GroupSettlementMemberInvalid();
  if (ACCOUNT_KEYS.includes(foreignKey)) return new GroupSettlementAccountInvalid();
  const check = violatedConstraint(error, '23514');
  if (MEMBER_KEYS.includes(check)) return new GroupSettlementMemberInvalid();
  if (ACCOUNT_KEYS.includes(check)) return new GroupSettlementAccountInvalid();
  if (AMOUNT_KEYS.includes(check)) return new SettlementAmountNotPositive();
  if (check === RATE_KEY) return new SettlementRateNotPositive();
  if (LEG_KEYS.includes(check) || LEG_KEYS.includes(violatedConstraint(error, '23505'))) {
    return new AppError('VALIDATION_FAILED', 'Invalid settlement legs', ['body.legs']);
  }
  return error;
}

function byCurrency(a: SettlementLeg, b: SettlementLeg): number {
  if (a.currency === b.currency) return 0;
  return a.currency < b.currency ? -1 : 1;
}

function toSettlement(row: SettlementRow, legs: SettlementLeg[]): GroupSettlement {
  return {
    ...row,
    // The column is free text; only the rate types of the shared contract are ever written.
    rateType: row.rateType as RateType | null,
    legs,
  };
}

async function loadLegs(
  db: Executor,
  groupId: string,
  settlementIds: readonly string[],
): Promise<Map<string, SettlementLeg[]>> {
  const bySettlement = new Map<string, SettlementLeg[]>();
  if (settlementIds.length === 0) return bySettlement;
  const rows = await db
    .select({
      settlementId: groupSettlementLegs.settlementId,
      currency: groupSettlementLegs.currency,
      amount: groupSettlementLegs.amount,
    })
    .from(groupSettlementLegs)
    .where(
      and(
        eq(groupSettlementLegs.groupId, groupId),
        inArray(groupSettlementLegs.settlementId, settlementIds),
      ),
    );
  for (const row of rows) {
    const list = bySettlement.get(row.settlementId) ?? [];
    list.push({ currency: row.currency, amount: row.amount });
    bySettlement.set(row.settlementId, list);
  }
  for (const list of bySettlement.values()) list.sort(byCurrency);
  return bySettlement;
}

interface AggregateRow {
  currency: AccountCurrency;
  memberId: string;
  total: string;
}

function fill(rows: AggregateRow[], target: Record<AccountCurrency, Map<string, bigint>>): void {
  for (const row of rows) {
    const map = target[row.currency];
    map.set(row.memberId, (map.get(row.memberId) ?? 0n) + BigInt(row.total));
  }
}

/**
 * The three sources of spec D1, each aggregated by currency and member and filtered by the group
 * id: paid by payer, shares by member and legs by from/to member. `sum(bigint)` is numeric, so it
 * is cast to text to reach `BigInt` exactly. The queries run in sequence so the same function
 * works on a transaction handle.
 */
async function readSources(db: Executor, groupId: string): Promise<BalanceSourcesByCurrency> {
  const paid = await db
    .select({
      currency: groupExpenses.currency,
      memberId: groupExpenses.payerMemberId,
      total: sql<string>`sum(${groupExpenses.amount})::text`,
    })
    .from(groupExpenses)
    .where(eq(groupExpenses.groupId, groupId))
    .groupBy(groupExpenses.currency, groupExpenses.payerMemberId);
  const shares = await db
    .select({
      currency: groupExpenses.currency,
      memberId: groupExpenseShares.memberId,
      total: sql<string>`sum(${groupExpenseShares.amount})::text`,
    })
    .from(groupExpenseShares)
    .innerJoin(groupExpenses, eq(groupExpenses.id, groupExpenseShares.expenseId))
    .where(and(eq(groupExpenseShares.groupId, groupId), eq(groupExpenses.groupId, groupId)))
    .groupBy(groupExpenses.currency, groupExpenseShares.memberId);
  const legsFrom = await db
    .select({
      currency: groupSettlementLegs.currency,
      memberId: groupSettlements.fromMemberId,
      total: sql<string>`sum(${groupSettlementLegs.amount})::text`,
    })
    .from(groupSettlementLegs)
    .innerJoin(groupSettlements, eq(groupSettlements.id, groupSettlementLegs.settlementId))
    .where(and(eq(groupSettlementLegs.groupId, groupId), eq(groupSettlements.groupId, groupId)))
    .groupBy(groupSettlementLegs.currency, groupSettlements.fromMemberId);
  const legsTo = await db
    .select({
      currency: groupSettlementLegs.currency,
      memberId: groupSettlements.toMemberId,
      total: sql<string>`(-sum(${groupSettlementLegs.amount}))::text`,
    })
    .from(groupSettlementLegs)
    .innerJoin(groupSettlements, eq(groupSettlements.id, groupSettlementLegs.settlementId))
    .where(and(eq(groupSettlementLegs.groupId, groupId), eq(groupSettlements.groupId, groupId)))
    .groupBy(groupSettlementLegs.currency, groupSettlements.toMemberId);

  const ars = {
    paid: new Map<string, bigint>(),
    shares: new Map<string, bigint>(),
    legs: new Map<string, bigint>(),
  };
  const usd = {
    paid: new Map<string, bigint>(),
    shares: new Map<string, bigint>(),
    legs: new Map<string, bigint>(),
  };
  fill(paid, { ARS: ars.paid, USD: usd.paid });
  fill(shares, { ARS: ars.shares, USD: usd.shares });
  fill(legsFrom, { ARS: ars.legs, USD: usd.legs });
  fill(legsTo, { ARS: ars.legs, USD: usd.legs });
  return { ARS: ars, USD: usd };
}

async function readSettlement(
  db: Executor,
  groupId: string,
  settlementId: string,
): Promise<GroupSettlement | null> {
  const [row] = await db
    .select(settlementColumns)
    .from(groupSettlements)
    .where(and(eq(groupSettlements.id, settlementId), eq(groupSettlements.groupId, groupId)));
  if (!row) return null;
  const legs = await loadLegs(db, groupId, [row.id]);
  return toSettlement(row, legs.get(row.id) ?? []);
}

/** The group `for update` first (same order as `saveSettlement`), then the settlement in it. */
async function lockAndLoad(
  tx: GroupTx,
  groupId: string,
  settlementId: string,
  actorMemberId: string,
): Promise<GroupSettlement> {
  await lockGroup(tx, groupId, 'update');
  // The acting member must still be active, or the answer is 404 like a non-member.
  if (!(await allActiveMembers(tx, groupId, [actorMemberId]))) throw new ResourceNotFound();
  const stored = await readSettlement(tx, groupId, settlementId);
  if (stored === null) throw new ResourceNotFound();
  return stored;
}

function effectOf(settlement: GroupSettlement): SettlementEffect {
  return {
    fromMemberId: settlement.fromMemberId,
    toMemberId: settlement.toMemberId,
    legs: settlement.legs,
  };
}

/** Rows strictly after the cursor in `(occurred_at desc, id desc)` order. */
function afterCursor(cursor: Cursor | null): SQL | undefined {
  return cursor === null
    ? undefined
    : sql`(${groupSettlements.occurredAt}, ${groupSettlements.id}) < (${cursor.occurredAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`;
}

export class DrizzleGroupSettlementRepository implements GroupSettlementRepository {
  constructor(private readonly db: Database) {}

  async saveSettlement(data: NewGroupSettlement): Promise<GroupSettlement> {
    try {
      return await this.db.transaction(async (tx) => {
        // The group lock first, then the member rows: the same order on every write path.
        await lockGroup(tx, data.groupId, 'update');
        const involved = [data.fromMemberId, data.toMemberId, data.createdByMemberId];
        if (data.account !== null) involved.push(data.account.memberId);
        if (!(await allActiveMembers(tx, data.groupId, involved))) {
          throw new GroupSettlementMemberInvalid();
        }
        if (data.consolidation !== null) {
          const [a, b] = data.consolidation.memberIds;
          const current = pairLegs(balancesByCurrency(await readSources(tx, data.groupId)), a, b);
          if (
            current.ARS !== data.consolidation.legs.ARS ||
            current.USD !== data.consolidation.legs.USD
          ) {
            throw new GroupSettlementStale();
          }
        }
        const [row] = await tx
          .insert(groupSettlements)
          .values({
            groupId: data.groupId,
            fromMemberId: data.fromMemberId,
            toMemberId: data.toMemberId,
            createdByMemberId: data.createdByMemberId,
            currency: data.currency,
            amount: data.amount,
            occurredAt: data.occurredAt,
            accountId: data.account?.accountId ?? null,
            accountMemberId: data.account?.memberId ?? null,
            rate: data.rate?.value ?? null,
            rateSource: data.rate?.source ?? null,
            rateType: data.rate?.type ?? null,
            createdAt: data.activity.createdAt,
          })
          .returning(settlementColumns);
        if (!row) throw new Error('Inserting a group settlement returned no row');
        const legs = data.legs.map((leg) => ({ ...leg })).sort(byCurrency);
        if (legs.length > 0) {
          await tx.insert(groupSettlementLegs).values(
            legs.map((leg) => ({
              settlementId: row.id,
              groupId: data.groupId,
              currency: leg.currency,
              amount: leg.amount,
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
        return toSettlement(row, legs);
      });
    } catch (error) {
      throw mapWriteError(error);
    }
  }

  readBalanceSources(groupId: string): Promise<BalanceSourcesByCurrency> {
    return readSources(this.db, groupId);
  }

  async getSettlement(groupId: string, settlementId: string): Promise<GroupSettlement | null> {
    return readSettlement(this.db, groupId, settlementId);
  }

  async updateSettlement(data: UpdateGroupSettlementData): Promise<GroupSettlement> {
    try {
      return await this.db.transaction(async (tx) => {
        const stored = await lockAndLoad(
          tx,
          data.groupId,
          data.settlementId,
          data.activity.memberId,
        );
        if (isConsolidated(stored)) throw new GroupSettlementConsolidated();
        // What the request did not name is what the lock just read, never an earlier read.
        const amount = data.amount ?? stored.amount;
        const occurredAt = data.occurredAt ?? stored.occurredAt;
        const newLegs = [{ currency: stored.currency, amount }];
        const changed = settlementChangedMembers(effectOf(stored), {
          fromMemberId: stored.fromMemberId,
          toMemberId: stored.toMemberId,
          legs: newLegs,
        });
        if (!(await allActiveMembers(tx, data.groupId, changed))) {
          throw new GroupRecordFormerMember();
        }
        const [row] = await tx
          .update(groupSettlements)
          .set({ amount, occurredAt })
          .where(
            and(
              eq(groupSettlements.id, data.settlementId),
              eq(groupSettlements.groupId, data.groupId),
            ),
          )
          .returning(settlementColumns);
        if (!row) throw new Error('Updating a group settlement returned no row');
        await tx.delete(groupSettlementLegs).where(eq(groupSettlementLegs.settlementId, row.id));
        const legs = newLegs;
        await tx.insert(groupSettlementLegs).values(
          legs.map((leg) => ({
            settlementId: row.id,
            groupId: data.groupId,
            currency: leg.currency,
            amount: leg.amount,
          })),
        );
        // `before` and `after` are rebuilt from the row read under lock, not trusted from the
        // caller (spec D4).
        await tx.insert(groupActivityLog).values({
          groupId: data.groupId,
          memberId: data.activity.memberId,
          action: data.activity.action,
          subjectId: row.id,
          createdAt: data.activity.createdAt,
          before: settlementSnapshot(stored),
          after: settlementSnapshot({ ...stored, amount, occurredAt, legs }),
        });
        return toSettlement(row, legs);
      });
    } catch (error) {
      throw mapWriteError(error);
    }
  }

  async deleteSettlement(data: DeleteGroupSettlementData): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const stored = await lockAndLoad(
          tx,
          data.groupId,
          data.settlementId,
          data.activity.memberId,
        );
        const changed = settlementChangedMembers(effectOf(stored), null);
        if (!(await allActiveMembers(tx, data.groupId, changed))) {
          throw new GroupRecordFormerMember();
        }
        // The legs go by cascade.
        await tx
          .delete(groupSettlements)
          .where(
            and(
              eq(groupSettlements.id, data.settlementId),
              eq(groupSettlements.groupId, data.groupId),
            ),
          );
        await tx.insert(groupActivityLog).values({
          groupId: data.groupId,
          memberId: data.activity.memberId,
          action: data.activity.action,
          subjectId: data.settlementId,
          createdAt: data.activity.createdAt,
          before: settlementSnapshot(stored),
          after: null,
        });
      });
    } catch (error) {
      throw mapWriteError(error);
    }
  }

  async listSettlements(
    groupId: string,
    query: ListSettlementsPageQuery,
  ): Promise<GroupSettlementPageResult> {
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
    const rows = await this.db
      .select(settlementColumns)
      .from(groupSettlements)
      .where(and(eq(groupSettlements.groupId, groupId), afterCursor(cursor)))
      .orderBy(desc(groupSettlements.occurredAt), desc(groupSettlements.id))
      .limit(query.limit + 1);
    const page = pageOf(rows, query.limit);
    const legs = await loadLegs(
      this.db,
      groupId,
      page.items.map((row) => row.id),
    );
    return {
      items: page.items.map((row) => toSettlement(row, legs.get(row.id) ?? [])),
      nextCursor: page.nextCursor,
    };
  }
}
