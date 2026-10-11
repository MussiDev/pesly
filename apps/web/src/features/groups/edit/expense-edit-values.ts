import {
  BASIS_POINTS_TOTAL,
  formatMinorUnits,
  instantToZonedLocal,
  splitByBasisPoints,
  type GroupExpenseResponse,
} from '@pesly/shared';
import {
  buildExpenseRequest,
  formatPercentage,
  type ExpenseFieldErrors,
  type ExpenseFormValues,
  type ExpenseRequestContext,
} from '../expenses/form/expense-request';
import { amountToInput } from '../settlements/settlement-request';
import type { SplitFieldError } from '../split/split-request';
import type { SplitState } from '../split/split-state';
import type { ExpenseEditRequest } from '@/lib/local-store/group-queue';

export type ExpenseEditContext = Pick<
  ExpenseRequestContext,
  'members' | 'groupCategories' | 'timeZone' | 'locale' | 'now'
>;

export type ExpenseEditResult =
  | {
      request: ExpenseEditRequest;
      fields?: undefined;
      splitErrors?: undefined;
      difference?: undefined;
    }
  | {
      request?: undefined;
      fields: ExpenseFieldErrors;
      splitErrors?: SplitFieldError[];
      difference?: bigint | null;
    };

function language(locale: string): 'es' | 'en' {
  return locale.startsWith('es') ? 'es' : 'en';
}

/** The stored amounts as percentages, when those percentages give the same amounts back. */
function percentagesOf(
  amount: bigint,
  payerMemberId: string,
  shares: readonly { memberId: string; amount: string }[],
): Map<string, number> | null {
  if (amount <= 0n || !shares.some((share) => share.memberId === payerMemberId)) return null;
  const whole = BigInt(BASIS_POINTS_TOTAL);
  const points = new Map<string, number>();
  let assigned = 0;
  for (const share of shares) {
    // Basis points are at most 10,000, so they are safe as integers; parsed from text, not converted.
    const value = Number.parseInt(((BigInt(share.amount) * whole) / amount).toString(), 10);
    points.set(share.memberId, value);
    assigned += value;
  }
  // The leftover of the rounding goes to the payer first, as when the split was made.
  points.set(payerMemberId, (points.get(payerMemberId) ?? 0) + (BASIS_POINTS_TOTAL - assigned));
  const ordered = [
    payerMemberId,
    ...shares.map((share) => share.memberId).filter((id) => id !== payerMemberId),
  ];
  try {
    const rebuilt = splitByBasisPoints(
      amount,
      ordered.map((memberId) => ({ memberId, basisPoints: points.get(memberId) ?? 0 })),
    );
    const same = shares.every((share) => rebuilt.get(share.memberId) === BigInt(share.amount));
    return same ? points : null;
  } catch {
    // Percentages that cannot be formed (a negative remainder, say) mean "use exact amounts".
    return null;
  }
}

function exactState(
  amount: bigint,
  payerMemberId: string,
  shares: readonly { memberId: string; amount: string }[],
  locale: string,
): SplitState {
  return {
    mode: 'exact',
    selectedMemberIds: shares.map((share) => share.memberId),
    values: Object.fromEntries(
      shares.map((share) => [share.memberId, amountToInput(BigInt(share.amount), locale)]),
    ),
    amount,
    payerMemberId,
  };
}

function splitStateOf(
  expense: GroupExpenseResponse,
  queued: ExpenseEditRequest | undefined,
  amount: bigint,
  locale: string,
): SplitState {
  const payer = expense.payerMemberId;
  if (queued !== undefined) {
    const { split } = queued;
    if (split.mode === 'equal') {
      return {
        mode: 'equal',
        selectedMemberIds: [...split.memberIds],
        values: {},
        amount,
        payerMemberId: payer,
      };
    }
    if (split.mode === 'percentage') {
      return {
        mode: 'percentage',
        selectedMemberIds: split.shares.map((share) => share.memberId),
        values: Object.fromEntries(
          split.shares.map((share) => [
            share.memberId,
            formatPercentage(share.basisPoints, language(locale)),
          ]),
        ),
        amount,
        payerMemberId: payer,
      };
    }
    return exactState(amount, payer, split.shares, locale);
  }

  if (expense.splitMode === 'equal') {
    return {
      mode: 'equal',
      selectedMemberIds: expense.shares.map((share) => share.memberId),
      values: {},
      amount,
      payerMemberId: payer,
    };
  }
  if (expense.splitMode === 'percentage') {
    const points = percentagesOf(amount, payer, expense.shares);
    if (points !== null) {
      return {
        mode: 'percentage',
        selectedMemberIds: expense.shares.map((share) => share.memberId),
        values: Object.fromEntries(
          expense.shares.map((share) => [
            share.memberId,
            formatPercentage(points.get(share.memberId) ?? 0, language(locale)),
          ]),
        ),
        amount,
        payerMemberId: payer,
      };
    }
  }
  return exactState(amount, payer, expense.shares, locale);
}

/**
 * The form values for editing: from the queued request when the record already has one, otherwise
 * from the loaded record. Currency and payer are carried only so the form can show them as text.
 */
export function expenseEditValues(
  expense: GroupExpenseResponse,
  queued: ExpenseEditRequest | undefined,
  context: Pick<ExpenseEditContext, 'timeZone' | 'locale'>,
): ExpenseFormValues {
  const amount = BigInt(queued?.amount ?? expense.amount);
  return {
    amount: formatMinorUnits(amount, language(context.locale)),
    currency: expense.currency,
    occurredAt: instantToZonedLocal(
      new Date(queued?.occurredAt ?? expense.occurredAt),
      context.timeZone,
    ),
    payerMemberId: expense.payerMemberId,
    categoryId: queued?.categoryId ?? expense.categoryId,
    description: queued?.description ?? expense.description,
    payerAccountId: '',
    payerCategoryId: '',
    split: splitStateOf(expense, queued, amount, context.locale),
  };
}

/**
 * The update body for what was typed, with the creation rules and none of the fixed fields:
 * currency, payer and payer account are not read, and `baseVersion` belongs to the queue.
 */
export function buildExpenseEditRequest(
  values: ExpenseFormValues,
  context: ExpenseEditContext,
): ExpenseEditResult {
  // The fixed fields cannot be edited, so they are made valid here and never reported.
  const members = context.members.some((member) => member.id === values.payerMemberId)
    ? context.members
    : [...context.members, { id: values.payerMemberId }];
  const result = buildExpenseRequest(
    { ...values, currency: 'ARS' },
    {
      ...context,
      members,
      accounts: [],
      personalCategoryIds: [],
      currentMemberId: undefined,
    },
  );
  if (result.request === undefined) {
    const fields = { ...result.fields };
    delete fields.currency;
    delete fields.payer;
    delete fields.payerAccount;
    delete fields.payerCategory;
    return {
      fields,
      ...(result.splitErrors ? { splitErrors: result.splitErrors } : {}),
      difference: result.difference,
    };
  }
  const { amount, occurredAt, categoryId, description, split } = result.request;
  return { request: { amount, occurredAt, categoryId, description, split } };
}
