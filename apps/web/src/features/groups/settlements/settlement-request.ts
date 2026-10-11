import {
  MOVEMENT_AMOUNT_MAX_MINOR_UNITS,
  accountCurrencySchema,
  dateInTimeZone,
  formatMinorUnitsString,
  instantToZonedLocal,
  occurredAtSchema,
  parseAmountInput,
  todayInTimeZone,
  zonedLocalToInstant,
  type AccountCurrency,
  type CreateSettlementRequest,
} from '@pesly/shared';

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export type SettlementErrorKey =
  | 'memberRequired'
  | 'sameMember'
  | 'currencyInvalid'
  | 'amountInvalid'
  | 'amountNotPositive'
  | 'amountOutOfRange'
  | 'dateInvalid'
  | 'dateSkipped'
  | 'dateInFuture'
  | 'accountInvalid';

/** A catalog path under `groups.settlement.errors`. */
export type SettlementFieldMessage = `groups.settlement.errors.${SettlementErrorKey}`;

export type SettlementFieldName =
  'fromMember' | 'toMember' | 'currency' | 'amount' | 'occurredAt' | 'account';

export type SettlementFieldErrors = Partial<Record<SettlementFieldName, SettlementFieldMessage>>;

export interface SettlementFormValues {
  fromMemberId: string;
  toMemberId: string;
  currency: string;
  /** Typed in the locale notation. */
  amount: string;
  /** `YYYY-MM-DDTHH:mm`, the wall-clock time in the user's time zone. */
  occurredAt: string;
  /** Empty means "none". */
  accountId: string;
}

export interface SettlementRequestContext {
  /** The active members of the group, the only ones that can be chosen. */
  memberIds: readonly string[];
  selfMemberId: string;
  /** The ids of the account list the form loaded and offers for the chosen currency. */
  accountIds: readonly string[];
  timeZone: string;
  locale: string;
  now: Date;
}

export type SingleSettlementRequest = Extract<CreateSettlementRequest, { kind: 'single' }>;

export type SettlementRequestResult =
  | { request: SingleSettlementRequest; fields?: undefined }
  | { request?: undefined; fields: SettlementFieldErrors };

export interface SuggestedPayment {
  fromMemberId: string;
  toMemberId: string;
  amount: bigint;
}

function decimalSeparator(locale: string): string {
  const parts = new Intl.NumberFormat(locale).formatToParts(1.5);
  return parts.find((part) => part.type === 'decimal')?.value ?? '.';
}

/** Minor units as text the amount field reads back: locale decimal, no grouping, no zero cents. */
export function amountToInput(minor: bigint, locale: string): string {
  const negative = minor < 0n;
  const magnitude = negative ? -minor : minor;
  const cents = magnitude % 100n;
  const whole = (magnitude / 100n).toString();
  const sign = negative ? '-' : '';
  if (cents === 0n) return `${sign}${whole}`;
  return `${sign}${whole}${decimalSeparator(locale)}${cents.toString().padStart(2, '0')}`;
}

/** The form values for a suggested payment, or for an empty form when there is none. */
export function prefillSettlement(
  payment: SuggestedPayment | null,
  currency: AccountCurrency,
  context: { locale: string; timeZone: string; now: Date },
): SettlementFormValues {
  return {
    fromMemberId: payment?.fromMemberId ?? '',
    toMemberId: payment?.toMemberId ?? '',
    currency,
    amount: payment === null ? '' : amountToInput(payment.amount, context.locale),
    occurredAt: instantToZonedLocal(context.now, context.timeZone),
    accountId: '',
  };
}

export type LocalDateResult =
  | { occurredAt: string; error?: undefined }
  | { occurredAt?: undefined; error: 'dateInvalid' | 'dateSkipped' | 'dateInFuture' };

/** A local date-time to an ISO instant: valid, not in a time-zone gap, not in the future. */
export function parseLocalDateTime(value: string, timeZone: string, now: Date): LocalDateResult {
  if (!LOCAL_DATE_TIME.test(value)) return { error: 'dateInvalid' };
  const instant = zonedLocalToInstant(value, timeZone);
  if (instant === null) return { error: 'dateSkipped' };
  if (dateInTimeZone(instant, timeZone) > todayInTimeZone(now, timeZone)) {
    return { error: 'dateInFuture' };
  }
  const iso = instant.toISOString();
  if (!occurredAtSchema.safeParse(iso).success) return { error: 'dateInvalid' };
  return { occurredAt: iso };
}

/**
 * The single-settlement body for what was typed, or the catalog path of what is wrong per field.
 * Nothing is sent while any field is invalid. The account is sent only for a party who chose one.
 */
export function buildSettlementRequest(
  values: SettlementFormValues,
  context: SettlementRequestContext,
): SettlementRequestResult {
  const fields: SettlementFieldErrors = {};
  const active = new Set(context.memberIds);

  if (!active.has(values.fromMemberId)) {
    fields.fromMember = 'groups.settlement.errors.memberRequired';
  }
  if (!active.has(values.toMemberId)) {
    fields.toMember = 'groups.settlement.errors.memberRequired';
  } else if (values.toMemberId === values.fromMemberId) {
    fields.toMember = 'groups.settlement.errors.sameMember';
  }

  const currency = accountCurrencySchema.safeParse(values.currency);
  if (!currency.success) fields.currency = 'groups.settlement.errors.currencyInvalid';

  const amount = parseAmountInput(values.amount, context.locale);
  if (amount === null) fields.amount = 'groups.settlement.errors.amountInvalid';
  else if (amount <= 0n) fields.amount = 'groups.settlement.errors.amountNotPositive';
  else if (amount > MOVEMENT_AMOUNT_MAX_MINOR_UNITS) {
    fields.amount = 'groups.settlement.errors.amountOutOfRange';
  }

  const date = parseLocalDateTime(values.occurredAt, context.timeZone, context.now);
  if (date.error !== undefined) fields.occurredAt = `groups.settlement.errors.${date.error}`;

  const isParty =
    context.selfMemberId === values.fromMemberId || context.selfMemberId === values.toMemberId;
  let accountId: string | undefined;
  if (isParty && values.accountId !== '') {
    if (context.accountIds.includes(values.accountId)) accountId = values.accountId;
    else fields.account = 'groups.settlement.errors.accountInvalid';
  }

  if (
    Object.keys(fields).length > 0 ||
    !currency.success ||
    amount === null ||
    date.occurredAt === undefined
  ) {
    return { fields };
  }

  return {
    request: {
      kind: 'single',
      fromMemberId: values.fromMemberId,
      toMemberId: values.toMemberId,
      currency: currency.data,
      amount: formatMinorUnitsString(amount),
      occurredAt: date.occurredAt,
      ...(accountId === undefined ? {} : { accountId }),
    },
  };
}
