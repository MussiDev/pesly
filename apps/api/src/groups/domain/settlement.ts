import {
  AppError,
  convertMinorUnits,
  MOVEMENT_AMOUNT_MAX_MINOR_UNITS,
  simplifyDebts,
  type AccountCurrency,
  type DebtPayment,
  type RateType,
  type SettlementRateSource,
} from '@pesly/shared';

export const SETTLEMENT_CURRENCIES: readonly AccountCurrency[] = ['ARS', 'USD'];

/** One debt a settlement clears; positive means it moves from `from` to `to` (spec D3). */
export interface SettlementLeg {
  currency: AccountCurrency;
  amount: bigint;
}

export interface GroupSettlement {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  /** The currency of the cash that moves. */
  currency: AccountCurrency;
  /** The cash from `from` to `to`; 0 only for a consolidated settlement. */
  amount: bigint;
  legs: SettlementLeg[];
  occurredAt: Date;
  createdByMemberId: string;
  /** Null when no account was named, or after the account was erased. */
  accountId: string | null;
  accountMemberId: string | null;
  rate: bigint | null;
  rateSource: SettlementRateSource | null;
  rateType: RateType | null;
  createdAt: Date;
}

/** The rate a consolidated settlement stores: `automatic` carries its type, `manual` has none. */
export type SettlementRate =
  | { value: bigint; source: 'automatic'; type: RateType }
  | { value: bigint; source: 'manual'; type: null };

/**
 * What the three aggregates of spec D1 return for one currency, per member id: the expense
 * amounts they paid, their shares, and the signed legs of the settlements. Former members appear.
 */
export interface BalanceSources {
  paid: ReadonlyMap<string, bigint>;
  shares: ReadonlyMap<string, bigint>;
  legs: ReadonlyMap<string, bigint>;
}

export type BalanceSourcesByCurrency = Record<AccountCurrency, BalanceSources>;
export type BalancesByCurrency = Record<AccountCurrency, Map<string, bigint>>;

/** The legs of a pair, signed from the first member to the second. */
export type PairLegs = Record<AccountCurrency, bigint>;

export interface MemberBalance {
  memberId: string;
  balance: bigint;
}

export interface CurrencyBalances {
  /** Every active member and every former member with a non-zero balance. */
  members: MemberBalance[];
  payments: DebtPayment[];
}

export type GroupBalances = Record<AccountCurrency, CurrencyBalances>;

/** A member's balance in one currency: paid, minus shares, plus legs (spec D1). */
export function computeBalances(sources: BalanceSources): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  const add = (memberId: string, value: bigint) =>
    balances.set(memberId, (balances.get(memberId) ?? 0n) + value);
  for (const [memberId, value] of sources.paid) add(memberId, value);
  for (const [memberId, value] of sources.shares) add(memberId, -value);
  for (const [memberId, value] of sources.legs) add(memberId, value);
  return balances;
}

export function balancesByCurrency(sources: BalanceSourcesByCurrency): BalancesByCurrency {
  return { ARS: computeBalances(sources.ARS), USD: computeBalances(sources.USD) };
}

/** The balance of one member in both currencies, 0 when they never took part. */
export function balancesOf(
  balances: BalancesByCurrency,
  memberId: string,
): Record<AccountCurrency, bigint> {
  return { ARS: balances.ARS.get(memberId) ?? 0n, USD: balances.USD.get(memberId) ?? 0n };
}

export function hasOpenBalance(balances: BalancesByCurrency, memberId: string): boolean {
  const own = balancesOf(balances, memberId);
  return own.ARS !== 0n || own.USD !== 0n;
}

/**
 * The balances of a group as shown: active members in the order given, then former members that
 * still have a balance, with the simplified payments over everyone (spec D2, D16).
 */
export function presentBalances(
  balances: BalancesByCurrency,
  activeMemberIds: readonly string[],
): GroupBalances {
  const present = (currency: AccountCurrency): CurrencyBalances => {
    const byMember = balances[currency];
    const active = new Set(activeMemberIds);
    const members: MemberBalance[] = activeMemberIds.map((memberId) => ({
      memberId,
      balance: byMember.get(memberId) ?? 0n,
    }));
    const former = [...byMember.entries()]
      .filter(([memberId, balance]) => !active.has(memberId) && balance !== 0n)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([memberId, balance]) => ({ memberId, balance }));
    return { members: [...members, ...former], payments: simplifyDebts(byMember) };
  };
  return { ARS: present('ARS'), USD: present('USD') };
}

/**
 * The simplified payments of each currency between `a` and `b`, signed from `a` to `b`
 * (spec D6). A pair has at most one payment per currency because debtors and creditors are
 * disjoint sets.
 */
export function pairLegs(balances: BalancesByCurrency, a: string, b: string): PairLegs {
  const legFor = (currency: AccountCurrency): bigint => {
    let total = 0n;
    for (const payment of simplifyDebts(balances[currency])) {
      if (payment.from === a && payment.to === b) total += payment.amount;
      else if (payment.from === b && payment.to === a) total -= payment.amount;
    }
    return total;
  };
  return { ARS: legFor('ARS'), USD: legFor('USD') };
}

export interface Consolidation {
  fromMemberId: string;
  toMemberId: string;
  /** The cash in `currency`; never negative. */
  amount: bigint;
  currency: AccountCurrency;
  legs: SettlementLeg[];
}

/**
 * Cash of a consolidated settlement (spec D7): the leg in the chosen currency plus the other leg
 * converted at `rate`, signed from `a` to `b`. A negative cash swaps the parties and negates the
 * legs, so the stored amount is never negative.
 */
export function consolidate(
  a: string,
  b: string,
  legs: PairLegs,
  currency: AccountCurrency,
  rate: bigint,
): Consolidation {
  const other: AccountCurrency = currency === 'ARS' ? 'USD' : 'ARS';
  const converted = convertMinorUnits(legs[other], other, rate);
  const cash = legs[currency] + converted;
  if (
    abs(converted) > MOVEMENT_AMOUNT_MAX_MINOR_UNITS ||
    abs(cash) > MOVEMENT_AMOUNT_MAX_MINOR_UNITS
  ) {
    throw new SettlementCashTooLarge();
  }
  const sign = cash < 0n ? -1n : 1n;
  return {
    fromMemberId: sign === 1n ? a : b,
    toMemberId: sign === 1n ? b : a,
    amount: cash * sign,
    currency,
    legs: [
      { currency: 'ARS', amount: legs.ARS * sign },
      { currency: 'USD', amount: legs.USD * sign },
    ],
  };
}

const abs = (value: bigint): bigint => (value < 0n ? -value : value);

/** The cash of a consolidation, or a converted leg, is above the movement maximum (400, spec D7). */
export class SettlementCashTooLarge extends AppError {
  constructor() {
    super('VALIDATION_FAILED', 'The consolidated amount exceeds the maximum', [
      'body.legs',
      'body.rate',
    ]);
  }
}

/** A settlement amount that is zero or negative (400 `VALIDATION_FAILED`, spec D4). */
export class SettlementAmountNotPositive extends AppError {
  constructor() {
    super('VALIDATION_FAILED', 'The settlement amount must be positive', ['body.amount']);
  }
}

/** The settlement is dated more than 1 day after the clock (400 `VALIDATION_FAILED`). */
export class SettlementDateTooFarAhead extends AppError {
  constructor() {
    super('VALIDATION_FAILED', 'The settlement date is more than 1 day in the future', [
      'body.occurredAt',
    ]);
  }
}

/** A manual rate of 0 or less (400 `VALIDATION_FAILED`, spec D8). */
export class SettlementRateNotPositive extends AppError {
  constructor() {
    super('VALIDATION_FAILED', 'The rate must be greater than 0', ['body.rate']);
  }
}

/** An admin tried to remove themselves; leaving is a different action (400, spec D9). */
export class CannotRemoveSelf extends AppError {
  constructor() {
    super('VALIDATION_FAILED', 'Use leave to exit the group yourself', ['params.memberId']);
  }
}
