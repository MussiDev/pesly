import type {
  BalancesResponse,
  ConsolidationPreview,
  CurrencyBalancesResponse,
  SettlementPage,
  SettlementResponse,
} from '@pesly/shared';
import type { ConsolidationPreviewResult } from '../../application/preview-consolidation';
import type { GroupSettlementPageResult } from '../../application/ports/group-settlement-repository';
import type { CurrencyBalances, GroupBalances, GroupSettlement } from '../../domain/settlement';

/** The only place where settlement bigints become strings and dates become ISO strings. */
export function presentSettlement(settlement: GroupSettlement): SettlementResponse {
  return {
    id: settlement.id,
    groupId: settlement.groupId,
    fromMemberId: settlement.fromMemberId,
    toMemberId: settlement.toMemberId,
    currency: settlement.currency,
    amount: settlement.amount.toString(),
    legs: settlement.legs.map((leg) => ({
      currency: leg.currency,
      amount: leg.amount.toString(),
    })),
    occurredAt: settlement.occurredAt.toISOString(),
    createdByMemberId: settlement.createdByMemberId,
    accountId: settlement.accountId,
    rate: settlement.rate === null ? null : settlement.rate.toString(),
    rateSource: settlement.rateSource,
    rateType: settlement.rateType,
    createdAt: settlement.createdAt.toISOString(),
  };
}

export function presentSettlementPage(page: GroupSettlementPageResult): SettlementPage {
  return { items: page.items.map(presentSettlement), nextCursor: page.nextCursor };
}

function presentCurrencyBalances(balances: CurrencyBalances): CurrencyBalancesResponse {
  return {
    members: balances.members.map(({ memberId, balance }) => ({
      memberId,
      balance: balance.toString(),
    })),
    payments: balances.payments.map(({ from, to, amount }) => ({
      fromMemberId: from,
      toMemberId: to,
      amount: amount.toString(),
    })),
  };
}

export function presentBalancesResponse(balances: GroupBalances): BalancesResponse {
  return {
    ARS: presentCurrencyBalances(balances.ARS),
    USD: presentCurrencyBalances(balances.USD),
  };
}

export function presentConsolidationPreview(
  preview: ConsolidationPreviewResult,
): ConsolidationPreview {
  return {
    legs: { ARS: preview.legs.ARS.toString(), USD: preview.legs.USD.toString() },
    defaultRateType: preview.defaultRateType,
    rate: preview.rate === null ? null : preview.rate.toString(),
  };
}
