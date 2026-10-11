import { randomUUID } from 'node:crypto';
import type { AccountCurrency, RateType } from '@pesly/shared';
import {
  assertChangedMembersActive,
  balancesByCurrency,
  GroupLastAdmin,
  GroupSettlementConsolidated,
  GroupMemberHasBalance,
  GroupSettlementMemberInvalid,
  GroupSettlementStale,
  hasOpenBalance,
  isConsolidated,
  pairLegs,
  settlementChangedMembers,
  settlementSnapshot,
  type BalanceSourcesByCurrency,
  type DefaultSplit,
  type DeleteGroupSettlementData,
  type GroupDetail,
  type GroupSettlement,
  type GroupSettlementPageResult,
  type GroupSettlementRepository,
  type ListSettlementsPageQuery,
  type Member,
  type NewGroupSettlement,
  type RateReader,
  type RemoveMemberData,
  type SettlementAccountCheck,
  type SettlementAccountChecker,
  type UpdateGroupSettlementData,
} from '../../src/groups';
import { ResourceNotFound } from '../../src/shared/access';
import type { InMemoryGroupExpenseRepository } from './expense-fakes';
import { InMemoryGroupRepository } from './fakes';

const CURRENCIES: readonly AccountCurrency[] = ['ARS', 'USD'];

type BalancesReader = (groupId: string) => Record<AccountCurrency, Map<string, bigint>>;

/**
 * The 05a fake plus soft removal: a member who left moves to `formerMembers`, so every lookup of
 * the base class (which reads `members`) ignores them, as the Drizzle adapter does with `left_at`.
 */
export class InMemoryMembershipGroupRepository extends InMemoryGroupRepository {
  readonly formerMembers: Member[] = [];
  readonly leftAt = new Map<string, Date>();
  private readBalances: BalancesReader | null = null;
  private splits: Map<string, DefaultSplit> | null = null;

  attach(balances: BalancesReader, defaultSplits: Map<string, DefaultSplit>): void {
    this.readBalances = balances;
    this.splits = defaultSplits;
  }

  override async getGroup(groupId: string): Promise<GroupDetail | null> {
    const detail = await super.getGroup(groupId);
    if (detail === null) return null;
    const formerMembers = this.formerMembers
      .filter((m) => m.groupId === groupId)
      .map((m) => ({
        id: m.id,
        displayName: m.displayName,
        leftAt: this.leftAt.get(m.id) ?? m.joinedAt,
      }));
    return { ...detail, formerMembers };
  }

  /** Same order and errors as the Drizzle `removeMember`: lock, balance, last admin, then write. */
  override async removeMember(data: RemoveMemberData): Promise<Member> {
    await Promise.resolve();
    const member = this.members.find((m) => m.groupId === data.groupId && m.id === data.memberId);
    if (member === undefined) throw new ResourceNotFound();
    if (this.readBalances === null) throw new Error('balances not attached');
    const balances = this.readBalances(data.groupId);
    const own = {
      ARS: balances.ARS.get(member.id) ?? 0n,
      USD: balances.USD.get(member.id) ?? 0n,
    };
    if (own.ARS !== 0n || own.USD !== 0n) throw new GroupMemberHasBalance(own);
    const others = this.membersOf(data.groupId).filter((m) => m.id !== member.id);
    if (member.role === 'admin' && others.length > 0 && !others.some((m) => m.role === 'admin')) {
      throw new GroupLastAdmin();
    }
    this.members.splice(this.members.indexOf(member), 1);
    this.formerMembers.push(member);
    this.leftAt.set(member.id, data.leftAt);
    this.dropRows(this.invitations, member.id);
    this.dropRows(this.claimLinks, member.id, true);
    const split = this.splits?.get(data.groupId);
    if (split?.mode === 'percentage' && split.shares.some((s) => s.memberId === member.id)) {
      this.splits?.set(data.groupId, { mode: 'equal' });
    }
    return member;
  }

  private dropRows(
    rows: { memberId: string; usedAt?: Date | null }[],
    memberId: string,
    unused = false,
  ) {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row?.memberId === memberId && (!unused || row.usedAt === null)) rows.splice(index, 1);
    }
  }
}

function newestFirst(a: GroupSettlement, b: GroupSettlement): number {
  const byTime = b.occurredAt.getTime() - a.occurredAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : -1;
}

function afterCursor(settlement: GroupSettlement, cursor: string | undefined): boolean {
  if (cursor === undefined) return true;
  const [at, id] = cursor.split('|');
  const time = new Date(at ?? '').getTime();
  if (settlement.occurredAt.getTime() !== time) return settlement.occurredAt.getTime() < time;
  return settlement.id < (id ?? '');
}

/**
 * Derives the balances from the committed expenses and settlements of the other fakes, like the
 * SQL aggregates do. It folds each new row once, so 10,000 operations stay linear.
 */
export class InMemoryGroupSettlementRepository implements GroupSettlementRepository {
  readonly settlements: GroupSettlement[] = [];
  /** When set, the write fails after the legs were staged (atomicity test). */
  failAfterLegs = false;
  constructor(
    private readonly groups: InMemoryMembershipGroupRepository,
    private readonly expenses: InMemoryGroupExpenseRepository,
  ) {
    groups.attach((groupId) => balancesByCurrency(this.sourcesOf(groupId)), expenses.defaultSplits);
  }

  async saveSettlement(data: NewGroupSettlement): Promise<GroupSettlement> {
    await Promise.resolve();
    const involved = [data.fromMemberId, data.toMemberId, data.createdByMemberId];
    if (data.account !== null) involved.push(data.account.memberId);
    const active = new Set(this.groups.membersOf(data.groupId).map((m) => m.id));
    if (involved.some((id) => !active.has(id))) throw new GroupSettlementMemberInvalid();
    if (data.consolidation !== null) {
      const [a, b] = data.consolidation.memberIds;
      const current = pairLegs(balancesByCurrency(this.sourcesOf(data.groupId)), a, b);
      if (
        current.ARS !== data.consolidation.legs.ARS ||
        current.USD !== data.consolidation.legs.USD
      ) {
        throw new GroupSettlementStale();
      }
    }
    const settlement: GroupSettlement = {
      id: randomUUID(),
      groupId: data.groupId,
      fromMemberId: data.fromMemberId,
      toMemberId: data.toMemberId,
      currency: data.currency,
      amount: data.amount,
      legs: data.legs.map((leg) => ({ ...leg })),
      occurredAt: data.occurredAt,
      createdByMemberId: data.createdByMemberId,
      accountId: data.account?.accountId ?? null,
      accountMemberId: data.account?.memberId ?? null,
      rate: data.rate?.value ?? null,
      rateSource: data.rate?.source ?? null,
      rateType: data.rate?.type ?? null,
      createdAt: data.activity.createdAt,
    };
    if (this.failAfterLegs) throw new Error('forced failure');
    this.settlements.push(settlement);
    this.expenses.ledger.applySettlement(settlement, 1n);
    this.expenses.activity.push({
      id: randomUUID(),
      groupId: data.groupId,
      memberId: data.activity.memberId,
      action: data.activity.action,
      subjectId: settlement.id,
      createdAt: data.activity.createdAt,
      before: null,
      after: null,
    });
    return settlement;
  }

  async getSettlement(groupId: string, settlementId: string): Promise<GroupSettlement | null> {
    await Promise.resolve();
    return this.settlements.find((s) => s.groupId === groupId && s.id === settlementId) ?? null;
  }

  async updateSettlement(data: UpdateGroupSettlementData): Promise<GroupSettlement> {
    await Promise.resolve();
    const index = this.settlements.findIndex(
      (s) => s.groupId === data.groupId && s.id === data.settlementId,
    );
    const stored = this.settlements[index];
    if (stored === undefined) throw new ResourceNotFound();
    if (isConsolidated(stored)) throw new GroupSettlementConsolidated();
    // What the request did not name comes from the row read under lock, like the adapter.
    const amount = data.amount ?? stored.amount;
    const legs = [{ currency: stored.currency, amount }];
    // The lock-time recheck of D5, from the row read under lock.
    assertChangedMembersActive(
      settlementChangedMembers(stored, {
        fromMemberId: stored.fromMemberId,
        toMemberId: stored.toMemberId,
        legs,
      }),
      this.activeIds(data.groupId),
    );
    const updated: GroupSettlement = {
      ...stored,
      amount,
      occurredAt: data.occurredAt ?? stored.occurredAt,
      legs,
    };
    if (this.failAfterLegs) throw new Error('forced failure');
    this.expenses.ledger.applySettlement(stored, -1n);
    this.expenses.ledger.applySettlement(updated, 1n);
    this.settlements[index] = updated;
    this.expenses.logChange(data.groupId, stored.id, {
      ...data.activity,
      before: settlementSnapshot(stored),
      after: settlementSnapshot(updated),
    });
    return updated;
  }

  async deleteSettlement(data: DeleteGroupSettlementData): Promise<void> {
    await Promise.resolve();
    const index = this.settlements.findIndex(
      (s) => s.groupId === data.groupId && s.id === data.settlementId,
    );
    const stored = this.settlements[index];
    if (stored === undefined) throw new ResourceNotFound();
    assertChangedMembersActive(
      settlementChangedMembers(stored, null),
      this.activeIds(data.groupId),
    );
    if (this.failAfterLegs) throw new Error('forced failure');
    this.expenses.ledger.applySettlement(stored, -1n);
    this.settlements.splice(index, 1);
    this.expenses.logChange(data.groupId, stored.id, {
      ...data.activity,
      before: settlementSnapshot(stored),
    });
  }

  private activeIds(groupId: string): ReadonlySet<string> {
    return new Set(this.groups.membersOf(groupId).map((m) => m.id));
  }

  async readBalanceSources(groupId: string): Promise<BalanceSourcesByCurrency> {
    await Promise.resolve();
    return this.sourcesOf(groupId);
  }

  async listSettlements(
    groupId: string,
    query: ListSettlementsPageQuery,
  ): Promise<GroupSettlementPageResult> {
    await Promise.resolve();
    const all = this.settlements
      .filter((s) => s.groupId === groupId)
      .sort(newestFirst)
      .filter((s) => afterCursor(s, query.cursor));
    const items = all.slice(0, query.limit);
    const last = items[items.length - 1];
    const nextCursor =
      all.length > query.limit && last !== undefined
        ? `${last.occurredAt.toISOString()}|${last.id}`
        : null;
    return { items, nextCursor };
  }

  private sourcesOf(groupId: string): BalanceSourcesByCurrency {
    return this.expenses.ledger.sourcesOf(groupId);
  }

  /** Test helper: do the stored balances of the group sum to zero in each currency? */
  sumsToZero(groupId: string): boolean {
    const balances = balancesByCurrency(this.sourcesOf(groupId));
    return CURRENCIES.every((currency) => {
      let total = 0n;
      for (const value of balances[currency].values()) total += value;
      return total === 0n;
    });
  }

  /** Test helper: does the member have a non-zero balance in any currency? */
  hasOpenBalance(groupId: string, memberId: string): boolean {
    return hasOpenBalance(balancesByCurrency(this.sourcesOf(groupId)), memberId);
  }
}

interface FakeAccount {
  userId: string;
  currency: AccountCurrency;
  archived: boolean;
}

export class InMemorySettlementAccountChecker implements SettlementAccountChecker {
  readonly accounts = new Map<string, FakeAccount>();

  seedAccount(userId: string, currency: AccountCurrency, archived = false): string {
    const id = randomUUID();
    this.accounts.set(id, { userId, currency, archived });
    return id;
  }

  async isUsable(check: SettlementAccountCheck): Promise<boolean> {
    await Promise.resolve();
    const account = this.accounts.get(check.accountId);
    return (
      account !== undefined &&
      account.userId === check.userId &&
      account.currency === check.currency &&
      !account.archived
    );
  }
}

export class InMemoryRateReader implements RateReader {
  private readonly stored = new Map<RateType, bigint>();

  set(rateType: RateType, sell: bigint): void {
    this.stored.set(rateType, sell);
  }

  async latestSell(rateType: RateType): Promise<{ sell: bigint } | null> {
    await Promise.resolve();
    const sell = this.stored.get(rateType);
    return sell === undefined ? null : { sell };
  }
}
