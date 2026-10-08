import {
  dateInTimeZone,
  formatMinorUnitsString,
  movementNoteSchema,
  occurredAtSchema,
  todayInTimeZone,
  zonedLocalToInstant,
  type CreateStatementPaymentRequest,
} from '@pesly/shared';
import type { MovementFieldMessage } from '@/features/movements/movement-form-errors';
import { parseAmountField } from '@/features/movements/movement-request';

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

export type StatementPaymentFieldName =
  'currency' | 'sourceAccount' | 'amount' | 'occurredAt' | 'note';

/** Catalog paths: the movement validation wordings, plus the card's own currency one. */
export type StatementPaymentFieldMessage =
  MovementFieldMessage | 'creditCards.expense.errors.currencyRequired';

export type StatementPaymentFieldErrors = Partial<
  Record<StatementPaymentFieldName, StatementPaymentFieldMessage>
>;

export interface StatementPaymentFormValues {
  currency: string;
  sourceAccountId: string;
  amount: string;
  /** `datetime-local` value, in the user's time zone. */
  occurredAt: string;
  note: string;
}

export interface StatementPaymentRequestContext {
  /** The accounts the person can pay from; the card's own are not offered. */
  accounts: readonly { id: string; currency: string; archived: boolean }[];
  timeZone: string;
  locale: string;
  now: Date;
}

export type StatementPaymentRequestResult =
  | { request: CreateStatementPaymentRequest; fields?: undefined }
  | { request?: undefined; fields: StatementPaymentFieldErrors };

function toCurrency(value: string): CreateStatementPaymentRequest['currency'] | undefined {
  return value === 'ARS' || value === 'USD' ? value : undefined;
}

/**
 * The request to send for what the user entered, or the per-field messages explaining why there is
 * none. The source account has to be open and in the chosen currency (AC-02), which the server
 * checks again.
 */
export function buildStatementPaymentRequest(
  values: StatementPaymentFormValues,
  context: StatementPaymentRequestContext,
): StatementPaymentRequestResult {
  const { accounts, timeZone, locale, now } = context;
  const fields: StatementPaymentFieldErrors = {};

  const currency = toCurrency(values.currency);
  if (currency === undefined) fields.currency = 'creditCards.expense.errors.currencyRequired';

  const source = accounts.find((item) => item.id === values.sourceAccountId && !item.archived);
  if (source === undefined) fields.sourceAccount = 'movements.errors.accountRequired';
  else if (currency !== undefined && source.currency !== currency) {
    fields.sourceAccount = 'errors.movementCurrencyMismatch';
  }

  const amount = parseAmountField(values.amount, locale);
  if (amount.message !== undefined) fields.amount = amount.message;

  let occurredAt: string | undefined;
  if (!LOCAL_DATE_TIME.test(values.occurredAt)) {
    fields.occurredAt = 'movements.errors.dateInvalid';
  } else {
    const instant = zonedLocalToInstant(values.occurredAt, timeZone);
    if (instant === null) fields.occurredAt = 'movements.errors.dateSkipped';
    else if (dateInTimeZone(instant, timeZone) > todayInTimeZone(now, timeZone)) {
      fields.occurredAt = 'errors.movementDateInFuture';
    } else if (!occurredAtSchema.safeParse(instant.toISOString()).success) {
      fields.occurredAt = 'movements.errors.dateInvalid';
    } else occurredAt = instant.toISOString();
  }

  const note = movementNoteSchema.safeParse(values.note);
  if (!note.success) {
    fields.note = CONTROL_OR_FORMAT.test(values.note)
      ? 'movements.errors.noteInvalidCharacters'
      : 'movements.errors.noteTooLong';
  }

  if (
    Object.keys(fields).length > 0 ||
    currency === undefined ||
    source === undefined ||
    amount.amount === undefined ||
    occurredAt === undefined ||
    !note.success
  ) {
    return { fields };
  }

  return {
    request: {
      currency,
      sourceAccountId: source.id,
      amount: formatMinorUnitsString(amount.amount),
      occurredAt,
      ...(note.data === undefined ? {} : { note: note.data }),
    },
  };
}
