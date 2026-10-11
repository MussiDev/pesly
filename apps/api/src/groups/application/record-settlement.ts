import type { AccountCurrency, CreateSettlementRequest, RateType } from '@pesly/shared';
import { ResourceNotFound } from '../../shared/access';
import {
  GroupSettlementAccountInvalid,
  GroupSettlementMemberInvalid,
  GroupSettlementNothingToConsolidate,
  GroupSettlementStale,
  SettlementRateRequired,
} from '../domain/errors';
import { isTooFarAhead } from '../domain/group-expense';
import {
  balancesByCurrency,
  consolidate,
  pairLegs,
  SettlementAmountNotPositive,
  SettlementDateTooFarAhead,
  SettlementRateNotPositive,
  type GroupSettlement,
  type SettlementLeg,
  type SettlementRate,
} from '../domain/settlement';
import { GroupAccess } from './group-access';
import type { Clock } from './ports/clock';
import type { GroupRepository } from './ports/group-repository';
import type {
  ConsolidationCheck,
  GroupSettlementRepository,
} from './ports/group-settlement-repository';
import type { RateReader } from './ports/rate-reader';
import type { SettlementAccountChecker } from './ports/settlement-account-checker';

export interface RecordSettlementDependencies {
  groups: GroupRepository;
  settlements: GroupSettlementRepository;
  accounts: SettlementAccountChecker;
  rates: RateReader;
  clock: Clock;
}

type SingleRequest = Extract<CreateSettlementRequest, { kind: 'single' }>;
type ConsolidatedRequest = Extract<CreateSettlementRequest, { kind: 'consolidated' }>;

/** What both kinds resolve to before the one write. */
interface Plan {
  fromMemberId: string;
  toMemberId: string;
  currency: AccountCurrency;
  amount: bigint;
  legs: SettlementLeg[];
  rate: SettlementRate | null;
  consolidation: ConsolidationCheck | null;
}

export class RecordSettlement {
  private readonly access: GroupAccess;

  constructor(private readonly deps: RecordSettlementDependencies) {
    this.access = new GroupAccess(deps.groups);
  }

  /**
   * Any member may record a payment between two active members (spec D4). Checks what needs state
   * (parties, account, legs, rate), converts a consolidation, and hands the repository one write
   * that includes the legs and the log row.
   */
  async execute(
    userId: string,
    groupId: string,
    data: CreateSettlementRequest,
  ): Promise<GroupSettlement> {
    const caller = await this.access.member(userId, groupId);
    const occurredAt = new Date(data.occurredAt);
    const now = this.deps.clock.now();
    if (isTooFarAhead(occurredAt, now)) throw new SettlementDateTooFarAhead();

    const detail = await this.deps.groups.getGroup(groupId);
    if (detail === null) throw new ResourceNotFound();
    const active = new Set(detail.members.map((member) => member.id));

    const plan =
      data.kind === 'single'
        ? this.planSingle(data, active)
        : await this.planConsolidated(data, groupId, active, detail.group.defaultRateType);

    let account: { accountId: string; memberId: string } | null = null;
    if (data.accountId !== undefined) {
      const isParty = caller.id === plan.fromMemberId || caller.id === plan.toMemberId;
      const usable =
        isParty &&
        (await this.deps.accounts.isUsable({
          userId,
          accountId: data.accountId,
          currency: plan.currency,
        }));
      if (!usable) throw new GroupSettlementAccountInvalid();
      account = { accountId: data.accountId, memberId: caller.id };
    }

    return this.deps.settlements.saveSettlement({
      groupId,
      fromMemberId: plan.fromMemberId,
      toMemberId: plan.toMemberId,
      currency: plan.currency,
      amount: plan.amount,
      legs: plan.legs,
      occurredAt,
      createdByMemberId: caller.id,
      account,
      rate: plan.rate,
      consolidation: plan.consolidation,
      activity: { action: 'settlement_created', memberId: caller.id, createdAt: now },
    });
  }

  private planSingle(data: SingleRequest, active: ReadonlySet<string>): Plan {
    const amount = BigInt(data.amount);
    if (amount <= 0n) throw new SettlementAmountNotPositive();
    if (
      data.fromMemberId === data.toMemberId ||
      !active.has(data.fromMemberId) ||
      !active.has(data.toMemberId)
    ) {
      throw new GroupSettlementMemberInvalid();
    }
    return {
      fromMemberId: data.fromMemberId,
      toMemberId: data.toMemberId,
      currency: data.currency,
      amount,
      legs: [{ currency: data.currency, amount }],
      rate: null,
      consolidation: null,
    };
  }

  private async planConsolidated(
    data: ConsolidatedRequest,
    groupId: string,
    active: ReadonlySet<string>,
    defaultRateType: RateType,
  ): Promise<Plan> {
    const [a, b] = data.memberIds;
    if (a === undefined || b === undefined || a === b || !active.has(a) || !active.has(b)) {
      throw new GroupSettlementMemberInvalid();
    }
    const sources = await this.deps.settlements.readBalanceSources(groupId);
    const current = pairLegs(balancesByCurrency(sources), a, b);
    if (current.ARS === 0n || current.USD === 0n) throw new GroupSettlementNothingToConsolidate();
    if (BigInt(data.legs.ARS) !== current.ARS || BigInt(data.legs.USD) !== current.USD) {
      throw new GroupSettlementStale();
    }

    const rate = await this.resolveRate(data.rate, defaultRateType);
    const cash = consolidate(a, b, current, data.currency, rate.value);
    return {
      fromMemberId: cash.fromMemberId,
      toMemberId: cash.toMemberId,
      currency: cash.currency,
      amount: cash.amount,
      legs: cash.legs,
      rate,
      consolidation: { memberIds: [a, b], legs: current },
    };
  }

  /** A manual rate wins; otherwise the stored rate of the group's default type (spec D8). */
  private async resolveRate(
    manual: string | undefined,
    defaultRateType: RateType,
  ): Promise<SettlementRate> {
    if (manual !== undefined) {
      const value = BigInt(manual);
      if (value <= 0n) throw new SettlementRateNotPositive();
      return { value, source: 'manual', type: null };
    }
    const stored = await this.deps.rates.latestSell(defaultRateType);
    if (stored === null) throw new SettlementRateRequired();
    return { value: stored.sell, source: 'automatic', type: defaultRateType };
  }
}
