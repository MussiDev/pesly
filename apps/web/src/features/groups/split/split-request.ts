import {
  BASIS_POINTS_TOTAL,
  GROUP_SPLIT_MEMBERS_MAX,
  MOVEMENT_AMOUNT_MAX_MINOR_UNITS,
  parseAmountInput,
  splitByBasisPoints,
  splitEqual,
  validateExactSplit,
  type GroupSplit,
} from '@pesly/shared';
import { parsePercentageInput } from './percentage-input';
import type { SplitState } from './split-state';

export interface SplitFieldError {
  /** The member the error belongs to, or `null` when it concerns the split as a whole. */
  memberId: string | null;
  /** A catalog path under `groups.split.errors`. */
  path: string;
}

export type BuildSplitResult =
  | { ok: true; split: GroupSplit }
  | {
      ok: false;
      errors: SplitFieldError[];
      /** Signed amount (minor units) or basis points still missing; `null` when not about totals. */
      difference: bigint | null;
    };

export interface ShareAmount {
  memberId: string;
  amount: bigint;
}

const ERR = {
  noMembers: 'groups.split.errors.noMembers',
  tooManyMembers: 'groups.split.errors.tooManyMembers',
  duplicateMember: 'groups.split.errors.duplicateMember',
  amountRequired: 'groups.split.errors.amountRequired',
  percentageInvalid: 'groups.split.errors.percentageInvalid',
  percentageTotal: 'groups.split.errors.percentageTotal',
  amountInvalid: 'groups.split.errors.amountInvalid',
  amountTotal: 'groups.split.errors.amountTotal',
} as const;

function fail(errors: SplitFieldError[], difference: bigint | null = null): BuildSplitResult {
  return { ok: false, errors, difference };
}

function parseExact(text: string | undefined, locale: string): bigint | null {
  if (text === undefined) return null;
  const value = parseAmountInput(text, locale);
  return value !== null && value >= 0n && value <= MOVEMENT_AMOUNT_MAX_MINOR_UNITS ? value : null;
}

/** Sum of the valid percentages typed so far, in basis points; invalid or empty values count as 0. */
function percentageSum(state: SplitState): bigint {
  let sum = 0n;
  for (const memberId of state.selectedMemberIds) {
    const bp = parsePercentageInput(state.values[memberId] ?? '');
    if (bp !== null) sum += BigInt(bp);
  }
  return sum;
}

/** Basis points still to assign: `10000 - total`, signed (negative when over 100%). */
export function percentageTotal(state: SplitState): bigint {
  return BigInt(BASIS_POINTS_TOTAL) - percentageSum(state);
}

/** Minor units still to assign: `amount - sum`, signed (negative when over the amount). */
export function exactRemaining(state: SplitState, amount: bigint, locale: string): bigint {
  let sum = 0n;
  for (const memberId of state.selectedMemberIds) {
    sum += parseExact(state.values[memberId], locale) ?? 0n;
  }
  return amount - sum;
}

/** Turns the editor state into the shared split body, or the field errors that stop it. */
export function buildSplit(
  state: SplitState,
  amount: bigint,
  _payerMemberId: string, // Only affects who gets leftover units, see previewShares.
  locale: string,
): BuildSplitResult {
  const ids = state.selectedMemberIds;
  if (ids.length === 0) return fail([{ memberId: null, path: ERR.noMembers }]);
  if (ids.length > GROUP_SPLIT_MEMBERS_MAX) {
    return fail([{ memberId: null, path: ERR.tooManyMembers }]);
  }
  if (new Set(ids).size !== ids.length) {
    return fail([{ memberId: null, path: ERR.duplicateMember }]);
  }
  if (amount <= 0n || amount > MOVEMENT_AMOUNT_MAX_MINOR_UNITS) {
    return fail([{ memberId: null, path: ERR.amountRequired }]);
  }

  if (state.mode === 'equal') {
    return { ok: true, split: { mode: 'equal', memberIds: [...ids] } };
  }

  if (state.mode === 'percentage') {
    const shares: { memberId: string; basisPoints: number }[] = [];
    const errors: SplitFieldError[] = [];
    for (const memberId of ids) {
      const basisPoints = parsePercentageInput(state.values[memberId] ?? '');
      if (basisPoints === null) errors.push({ memberId, path: ERR.percentageInvalid });
      else shares.push({ memberId, basisPoints });
    }
    if (errors.length > 0) return fail(errors);
    const difference =
      BigInt(BASIS_POINTS_TOTAL) - shares.reduce((s, x) => s + BigInt(x.basisPoints), 0n);
    if (difference !== 0n) return fail([{ memberId: null, path: ERR.percentageTotal }], difference);
    return { ok: true, split: { mode: 'percentage', shares } };
  }

  const shares: { memberId: string; amount: string }[] = [];
  const errors: SplitFieldError[] = [];
  let sum = 0n;
  for (const memberId of ids) {
    const value = parseExact(state.values[memberId], locale);
    if (value === null) errors.push({ memberId, path: ERR.amountInvalid });
    else {
      shares.push({ memberId, amount: value.toString() });
      sum += value;
    }
  }
  if (errors.length > 0) return fail(errors);
  const difference = amount - sum;
  if (difference !== 0n) return fail([{ memberId: null, path: ERR.amountTotal }], difference);
  return { ok: true, split: { mode: 'exact', shares } };
}

/**
 * What each member would owe. The shared allocators give the leftover minor units to the first
 * member of the list, so the payer goes first (then the others in selection order). `null` while
 * the split is not valid yet.
 */
export function previewShares(
  state: SplitState,
  amount: bigint,
  payerMemberId: string,
  locale: string,
): ShareAmount[] | null {
  const result = buildSplit(state, amount, payerMemberId, locale);
  if (!result.ok) return null;
  const { split } = result;
  const ordered = (ids: readonly string[]): string[] =>
    ids.includes(payerMemberId)
      ? [payerMemberId, ...ids.filter((id) => id !== payerMemberId)]
      : [...ids];
  let amounts: Map<string, bigint>;
  let order: string[];
  if (split.mode === 'equal') {
    order = ordered(split.memberIds);
    amounts = splitEqual(amount, order);
  } else if (split.mode === 'percentage') {
    const byMember = new Map(split.shares.map((s) => [s.memberId, s.basisPoints]));
    order = ordered(split.shares.map((s) => s.memberId));
    amounts = splitByBasisPoints(
      amount,
      order.map((memberId) => ({ memberId, basisPoints: byMember.get(memberId) ?? 0 })),
    );
  } else {
    order = ordered(split.shares.map((s) => s.memberId));
    amounts = validateExactSplit(
      amount,
      split.shares.map((s) => ({ memberId: s.memberId, amount: BigInt(s.amount) })),
    );
  }
  return order.map((memberId) => ({ memberId, amount: amounts.get(memberId) ?? 0n }));
}
