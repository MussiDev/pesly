import {
  INSTALLMENTS_MAX,
  INSTALLMENTS_MIN,
  formatMinorUnitsString,
  isCalendarDate,
  movementNoteSchema,
  todayInTimeZone,
  type CreateInstallmentPurchaseRequest,
} from '@pesly/shared';
import type { MovementFieldMessage } from '@/features/movements/movement-form-errors';
import { parseAmountField } from '@/features/movements/movement-request';

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const INTEGER = /^\d{1,3}$/;

export type InstallmentFieldName = 'amount' | 'installments' | 'category' | 'purchasedOn' | 'note';

/** Catalog paths: the movement validation wordings, plus the ones about installments. */
export type InstallmentFieldMessage =
  | MovementFieldMessage
  | 'creditCards.installments.errors.installmentsInvalid'
  | 'creditCards.installments.errors.amountTooSmall';

export type InstallmentFieldErrors = Partial<Record<InstallmentFieldName, InstallmentFieldMessage>>;

export interface InstallmentFormValues {
  amount: string;
  installments: string;
  categoryId: string;
  /** `date` input value, `YYYY-MM-DD`, in the user's time zone. */
  purchasedOn: string;
  note: string;
}

export interface InstallmentRequestContext {
  /** The open expense categories the person can pick. */
  categories: readonly { id: string; archived: boolean }[];
  timeZone: string;
  locale: string;
  now: Date;
}

export type InstallmentRequestResult =
  | { request: CreateInstallmentPurchaseRequest; fields?: undefined }
  | { request?: undefined; fields: InstallmentFieldErrors };

/**
 * The request to send for what the user entered, or the per-field messages explaining why there is
 * none. The currency is always ARS: installment purchases in USD do not exist (FR-02).
 */
export function buildInstallmentPurchaseRequest(
  values: InstallmentFormValues,
  context: InstallmentRequestContext,
): InstallmentRequestResult {
  const { categories, timeZone, locale, now } = context;
  const fields: InstallmentFieldErrors = {};

  const amount = parseAmountField(values.amount, locale);
  if (amount.message !== undefined) fields.amount = amount.message;

  const trimmed = values.installments.trim();
  const count = INTEGER.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!(count >= INSTALLMENTS_MIN && count <= INSTALLMENTS_MAX)) {
    fields.installments = 'creditCards.installments.errors.installmentsInvalid';
  } else if (amount.amount !== undefined && amount.amount < BigInt(count)) {
    fields.amount = 'creditCards.installments.errors.amountTooSmall';
  }

  const category = categories.find((item) => item.id === values.categoryId && !item.archived);
  if (category === undefined) fields.category = 'movements.errors.categoryRequired';

  if (!isCalendarDate(values.purchasedOn)) fields.purchasedOn = 'movements.errors.dateInvalid';
  else if (values.purchasedOn > todayInTimeZone(now, timeZone)) {
    fields.purchasedOn = 'errors.movementDateInFuture';
  }

  const note = movementNoteSchema.safeParse(values.note);
  if (!note.success) {
    fields.note = CONTROL_OR_FORMAT.test(values.note)
      ? 'movements.errors.noteInvalidCharacters'
      : 'movements.errors.noteTooLong';
  }

  if (
    Object.keys(fields).length > 0 ||
    amount.amount === undefined ||
    category === undefined ||
    !note.success
  ) {
    return { fields };
  }

  return {
    request: {
      currency: 'ARS',
      categoryId: category.id,
      amount: formatMinorUnitsString(amount.amount),
      installments: count,
      purchasedOn: values.purchasedOn,
      ...(note.data === undefined ? {} : { note: note.data }),
    },
  };
}
