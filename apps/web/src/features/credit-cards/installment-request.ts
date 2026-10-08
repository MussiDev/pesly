import {
  INSTALLMENTS_MAX,
  INSTALLMENTS_MIN,
  dateInTimeZone,
  formatMinorUnitsString,
  isCalendarDate,
  movementNoteSchema,
  todayInTimeZone,
  zonedLocalToInstant,
  type CreateCardExpenseRequest,
  type CreateInstallmentPurchaseRequest,
} from '@pesly/shared';
import type { MovementFieldMessage } from '@/features/movements/movement-form-errors';
import { parseAmountField } from '@/features/movements/movement-request';

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const INTEGER = /^\d{1,3}$/;

export type InstallmentFieldName =
  'currency' | 'amount' | 'installments' | 'category' | 'purchasedOn' | 'note';

/** Catalog paths: the movement validation wordings, plus the ones about installments. */
export type InstallmentFieldMessage =
  | MovementFieldMessage
  | 'creditCards.expense.errors.currencyRequired'
  | 'creditCards.installments.errors.installmentsInvalid'
  | 'creditCards.installments.errors.amountTooSmall';

export type InstallmentFieldErrors = Partial<Record<InstallmentFieldName, InstallmentFieldMessage>>;

export interface InstallmentFormValues {
  currency: string;
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

/** The fewest payments the form accepts: one payment is a plain card expense (10b). */
export const PURCHASE_PAYMENTS_MIN = 1;

/** What the form sends: one payment is a card expense, two or more an installment purchase. */
export type PurchaseRequest =
  | { kind: 'single'; request: CreateCardExpenseRequest }
  | { kind: 'installments'; request: CreateInstallmentPurchaseRequest };

export type InstallmentRequestResult =
  | { purchase: PurchaseRequest; fields?: undefined }
  | { purchase?: undefined; fields: InstallmentFieldErrors };

function toCurrency(value: string): 'ARS' | 'USD' | undefined {
  return value === 'ARS' || value === 'USD' ? value : undefined;
}

/** The instant of a card expense dated `purchasedOn`: now for today, noon of that day otherwise. */
function instantOfDay(purchasedOn: string, timeZone: string, now: Date): string | undefined {
  if (dateInTimeZone(now, timeZone) === purchasedOn) return now.toISOString();
  return zonedLocalToInstant(`${purchasedOn}T12:00`, timeZone)?.toISOString();
}

/**
 * The request to send for what the user entered, or the per-field messages explaining why there is
 * none. One payment becomes a card expense with the automatic rate (the screen is online only);
 * 2 to 60 payments become an installment purchase in the chosen currency.
 */
export function buildInstallmentPurchaseRequest(
  values: InstallmentFormValues,
  context: InstallmentRequestContext,
): InstallmentRequestResult {
  const { categories, timeZone, locale, now } = context;
  const fields: InstallmentFieldErrors = {};

  const currency = toCurrency(values.currency);
  if (currency === undefined) fields.currency = 'creditCards.expense.errors.currencyRequired';

  const amount = parseAmountField(values.amount, locale);
  if (amount.message !== undefined) fields.amount = amount.message;

  const trimmed = values.installments.trim();
  const count = INTEGER.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!(count >= PURCHASE_PAYMENTS_MIN && count <= INSTALLMENTS_MAX)) {
    fields.installments = 'creditCards.installments.errors.installmentsInvalid';
  } else if (
    count >= INSTALLMENTS_MIN &&
    amount.amount !== undefined &&
    amount.amount < BigInt(count)
  ) {
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
    currency === undefined ||
    amount.amount === undefined ||
    category === undefined ||
    !note.success
  ) {
    return { fields };
  }

  const money = formatMinorUnitsString(amount.amount);
  const noteField = note.data === undefined ? {} : { note: note.data };
  if (count < INSTALLMENTS_MIN) {
    const occurredAt = instantOfDay(values.purchasedOn, timeZone, now);
    if (occurredAt === undefined)
      return { fields: { purchasedOn: 'movements.errors.dateSkipped' } };
    return {
      purchase: {
        kind: 'single',
        request: {
          currency,
          categoryId: category.id,
          amount: money,
          occurredAt,
          ...noteField,
          rate: { source: 'automatic' },
        },
      },
    };
  }
  return {
    purchase: {
      kind: 'installments',
      request: {
        currency,
        categoryId: category.id,
        amount: money,
        installments: count,
        purchasedOn: values.purchasedOn,
        ...noteField,
      },
    },
  };
}
