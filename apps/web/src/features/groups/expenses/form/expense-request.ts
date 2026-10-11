import {
  GROUP_EXPENSE_DESCRIPTION_MAX_LENGTH,
  accountCurrencySchema,
  dateInTimeZone,
  formatMinorUnitsString,
  groupExpenseDescriptionSchema,
  occurredAtSchema,
  todayInTimeZone,
  zonedLocalToInstant,
  type CreateGroupExpenseRequest,
  type DefaultSplitResponse,
} from '@pesly/shared';
import { parseAmountField } from '@/features/movements/movement-request';
import { buildSplit, type SplitFieldError } from '../../split/split-request';
import { createSplitState, type SplitState } from '../../split/split-state';

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const ERR = 'groups.expenses.form.errors';

/** What the user typed or picked, untouched; `split` is the editor state of the split module. */
export interface ExpenseFormValues {
  amount: string;
  currency: string;
  /** `YYYY-MM-DDTHH:mm`, the wall-clock time in the user's time zone. */
  occurredAt: string;
  payerMemberId: string;
  categoryId: string;
  description: string;
  payerAccountId: string;
  payerCategoryId: string;
  split: SplitState;
}

export interface ExpenseRequestContext {
  /** Every member of the group, in joining order. */
  members: readonly { id: string }[];
  groupCategoryIds: readonly string[];
  accounts: readonly { id: string; currency: string; archived: boolean }[];
  personalCategoryIds: readonly string[];
  /** The caller's member id; without it no payer is "the current user". */
  currentMemberId: string | undefined;
  timeZone: string;
  locale: string;
  now: Date;
}

export type ExpenseFieldName =
  | 'amount'
  | 'currency'
  | 'occurredAt'
  | 'payer'
  | 'category'
  | 'description'
  | 'split'
  | 'payerAccount'
  | 'payerCategory';

/** A full catalog path per invalid field. */
export type ExpenseFieldErrors = Partial<Record<ExpenseFieldName, string>>;

export type ExpenseRequestResult =
  | {
      request: CreateGroupExpenseRequest;
      fields?: undefined;
      splitErrors?: undefined;
      difference?: undefined;
    }
  | {
      request?: undefined;
      fields: ExpenseFieldErrors;
      /** Per-member and whole-split errors of the split editor. */
      splitErrors?: SplitFieldError[];
      /** Signed difference of the split (basis points or minor units); `null` when not about totals. */
      difference?: bigint | null;
    };

/** Basis points as percentage text, `3333` to `33.33`, with integer arithmetic only. */
export function formatBasisPoints(basisPoints: number | bigint): string {
  const value = BigInt(basisPoints);
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`;
}

/** The same text in the notation of the interface language. */
export function formatPercentage(basisPoints: number | bigint, language: string): string {
  const text = formatBasisPoints(basisPoints);
  return language === 'es' ? text.replace('.', ',') : text;
}

/** The split an empty form starts from: the group's default, for the members still in the group. */
export function initialSplitState(
  defaultSplit: DefaultSplitResponse,
  memberIds: readonly string[],
  payerMemberId: string,
): SplitState {
  const base = createSplitState(0n, payerMemberId, memberIds);
  if (defaultSplit.mode === 'equal') return base;
  const values: Record<string, string> = {};
  for (const share of defaultSplit.shares) {
    if (memberIds.includes(share.memberId)) {
      values[share.memberId] = formatBasisPoints(share.basisPoints);
    }
  }
  return { ...base, mode: 'percentage', values };
}

/**
 * The state the split rules are applied to. Equal mode uses the checked members; percentage and
 * exact modes use the members that have a value typed, so a member left blank takes no part.
 */
export function effectiveSplitState(
  values: ExpenseFormValues,
  memberIds: readonly string[],
  amount: bigint,
): SplitState {
  const { split } = values;
  const selected =
    split.mode === 'equal'
      ? split.selectedMemberIds
      : memberIds.filter((id) => (split.values[id] ?? '').trim() !== '');
  return {
    ...split,
    selectedMemberIds: [...selected],
    amount,
    payerMemberId: values.payerMemberId,
  };
}

/** The accounts the payer may use for an expense in `currency`. */
export function eligibleAccounts<T extends { currency: string; archived: boolean }>(
  accounts: readonly T[],
  currency: string,
): T[] {
  return accounts.filter((account) => !account.archived && account.currency === currency);
}

/**
 * The request to send for what the user entered, or the per-field messages explaining why there is
 * none. Nothing is sent while any field is invalid.
 */
export function buildExpenseRequest(
  values: ExpenseFormValues,
  context: ExpenseRequestContext,
): ExpenseRequestResult {
  const fields: ExpenseFieldErrors = {};
  const memberIds = context.members.map((member) => member.id);

  const amount = parseAmountField(values.amount, context.locale);
  if (amount.message !== undefined) fields.amount = amount.message;

  const currency = accountCurrencySchema.safeParse(values.currency);
  if (!currency.success) fields.currency = `${ERR}.currencyInvalid`;

  const description = values.description.trim();
  if (description === '') fields.description = `${ERR}.descriptionRequired`;
  else if (Array.from(description).length > GROUP_EXPENSE_DESCRIPTION_MAX_LENGTH) {
    fields.description = `${ERR}.descriptionTooLong`;
  } else if (!groupExpenseDescriptionSchema.safeParse(description).success) {
    fields.description = `${ERR}.descriptionInvalid`;
  }

  if (!memberIds.includes(values.payerMemberId)) fields.payer = `${ERR}.payerRequired`;
  if (!context.groupCategoryIds.includes(values.categoryId)) {
    fields.category = `${ERR}.categoryRequired`;
  }

  let occurredAt: string | undefined;
  if (!LOCAL_DATE_TIME.test(values.occurredAt)) {
    fields.occurredAt = 'movements.errors.dateInvalid';
  } else {
    const instant = zonedLocalToInstant(values.occurredAt, context.timeZone);
    if (instant === null) fields.occurredAt = 'movements.errors.dateSkipped';
    else if (
      dateInTimeZone(instant, context.timeZone) > todayInTimeZone(context.now, context.timeZone)
    ) {
      fields.occurredAt = 'errors.movementDateInFuture';
    } else if (!occurredAtSchema.safeParse(instant.toISOString()).success) {
      fields.occurredAt = 'movements.errors.dateInvalid';
    } else occurredAt = instant.toISOString();
  }

  let splitErrors: SplitFieldError[] | undefined;
  let difference: bigint | null | undefined;
  let split: CreateGroupExpenseRequest['split'] | undefined;
  if (amount.amount !== undefined) {
    const result = buildSplit(
      effectiveSplitState(values, memberIds, amount.amount),
      amount.amount,
      values.payerMemberId,
      context.locale,
    );
    if (result.ok) split = result.split;
    else {
      splitErrors = result.errors;
      difference = result.difference;
      fields.split = result.errors[0]?.path;
    }
  }

  let payerAccount: CreateGroupExpenseRequest['payerAccount'];
  const payerIsCaller =
    context.currentMemberId !== undefined && values.payerMemberId === context.currentMemberId;
  if (payerIsCaller) {
    const usable = eligibleAccounts(context.accounts, values.currency);
    const account = usable.find((item) => item.id === values.payerAccountId);
    if (usable.length === 0) fields.payerAccount = `${ERR}.noAccountInCurrency`;
    else if (account === undefined) fields.payerAccount = `${ERR}.accountRequired`;
    if (!context.personalCategoryIds.includes(values.payerCategoryId)) {
      fields.payerCategory = `${ERR}.personalCategoryRequired`;
    }
    if (account !== undefined && fields.payerCategory === undefined) {
      payerAccount = { accountId: account.id, categoryId: values.payerCategoryId };
    }
  }

  if (
    Object.keys(fields).length > 0 ||
    amount.amount === undefined ||
    !currency.success ||
    occurredAt === undefined ||
    split === undefined
  ) {
    return { fields, ...(splitErrors ? { splitErrors } : {}), difference };
  }

  return {
    request: {
      amount: formatMinorUnitsString(amount.amount),
      currency: currency.data,
      occurredAt,
      payerMemberId: values.payerMemberId,
      categoryId: values.categoryId,
      description,
      split,
      ...(payerAccount === undefined ? {} : { payerAccount }),
    },
  };
}
