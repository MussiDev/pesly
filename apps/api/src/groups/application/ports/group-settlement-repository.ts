import type { AccountCurrency, SettlementSnapshot } from '@pesly/shared';
import type {
  BalanceSourcesByCurrency,
  GroupSettlement,
  PairLegs,
  SettlementLeg,
  SettlementRate,
} from '../../domain/settlement';

/** The log entry written with the settlement (spec D14); `createdAt` comes from the `Clock`. */
export interface NewSettlementActivity {
  action: 'settlement_created';
  memberId: string;
  createdAt: Date;
}

/** The pair and the legs the client saw, to be compared with the current ones under lock (D6). */
export interface ConsolidationCheck {
  memberIds: readonly [string, string];
  /** Signed from the first member to the second, as the preview returned them. */
  legs: PairLegs;
}

/** The log entry of an edit or a deletion of a settlement (spec D7). */
export interface SettlementChangeActivity {
  action: 'settlement_updated' | 'settlement_deleted';
  memberId: string;
  createdAt: Date;
  before: SettlementSnapshot;
  after: SettlementSnapshot | null;
}

/** A plain settlement's new amount and date (spec D2); its single leg follows the amount. */
export interface UpdateGroupSettlementData {
  groupId: string;
  settlementId: string;
  amount: bigint;
  occurredAt: Date;
  /** The single leg of the new amount: `[{ currency, amount }]`. */
  legs: SettlementLeg[];
  activity: SettlementChangeActivity & {
    action: 'settlement_updated';
    after: SettlementSnapshot;
  };
}

export interface DeleteGroupSettlementData {
  groupId: string;
  settlementId: string;
  activity: SettlementChangeActivity & { action: 'settlement_deleted'; after: null };
}

export interface NewGroupSettlement {
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  /** The cash currency. */
  currency: AccountCurrency;
  /** The cash, 0 or more; 0 only with a `rate`. */
  amount: bigint;
  legs: SettlementLeg[];
  occurredAt: Date;
  createdByMemberId: string;
  /** The caller's account and the caller's member id; null when no account was named. */
  account: { accountId: string; memberId: string } | null;
  rate: SettlementRate | null;
  /** Set only for a consolidated settlement. */
  consolidation: ConsolidationCheck | null;
  activity: NewSettlementActivity;
}

export interface ListSettlementsPageQuery {
  limit: number;
  /** Opaque; produced by a previous page. */
  cursor?: string;
}

export interface GroupSettlementPageResult {
  items: GroupSettlement[];
  nextCursor: string | null;
}

/**
 * Every read is scoped by group id; the use case checks membership first. Balances are derived
 * from the stored rows, never stored (spec D1).
 */
export interface GroupSettlementRepository {
  /**
   * One transaction: the settlement, its legs and the log row. Under lock it re-reads the
   * involved members (`from`, `to`, `createdBy` and the account member) and throws
   * `GroupSettlementMemberInvalid` when one is no longer active (spec D10); when `consolidation`
   * is set it recomputes the pair legs and throws `GroupSettlementStale` on a difference (D6).
   * Any failure leaves nothing behind.
   */
  saveSettlement(data: NewGroupSettlement): Promise<GroupSettlement>;
  /** Null when the settlement does not exist or belongs to another group. */
  getSettlement(groupId: string, settlementId: string): Promise<GroupSettlement | null>;
  /**
   * One transaction under the group row `for update` (spec D4): load the settlement in the group
   * (`ResourceNotFound` when gone), throw `GroupSettlementConsolidated` when it is consolidated,
   * recompute under lock which members' balances change (`settlementChangedMembers`) and throw
   * `GroupRecordFormerMember` when one is no longer active, rewrite `amount`, `occurred_at` and the
   * single leg, and insert the log row with `before` taken from the row read under lock.
   */
  updateSettlement(data: UpdateGroupSettlementData): Promise<GroupSettlement>;
  /**
   * Same locks and former-member check; the legs go by cascade and the log row is written. A
   * consolidated settlement may be deleted.
   */
  deleteSettlement(data: DeleteGroupSettlementData): Promise<void>;
  /** Paid, shares and legs per member and currency, former members included. */
  readBalanceSources(groupId: string): Promise<BalanceSourcesByCurrency>;
  /** Newest first (`occurred_at desc, id desc`), keyset pages. */
  listSettlements(
    groupId: string,
    query: ListSettlementsPageQuery,
  ): Promise<GroupSettlementPageResult>;
}
