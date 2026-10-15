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
  type InstallmentCurrency,
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

/** What the parser needs from the screen. */
export interface InstallmentDraftContext {
  timeZone: string;
  locale: string;
  now: Date;
}

export interface InstallmentRequestContext extends InstallmentDraftContext {
  /** The open expense categories the person can pick. */
  categories: readonly { id: string; archived: boolean }[];
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

function toCurrency(value: string): InstallmentCurrency | undefined {
  return value === 'ARS' || value === 'USD' ? value : undefined;
}

/** The instant of a card expense dated `purchasedOn`: now for today, noon of that day otherwise. */
function instantOfDay(purchasedOn: string, timeZone: string, now: Date): string | undefined {
  if (dateInTimeZone(now, timeZone) === purchasedOn) return now.toISOString();
  return zonedLocalToInstant(`${purchasedOn}T12:00`, timeZone)?.toISOString();
}

/** What the form holds once parsed; a field that is invalid has no value in the draft. */
export interface InstallmentDraft {
  currency?: InstallmentCurrency;
  /** Minor units. */
  amount?: bigint;
  count?: number;
  /** `YYYY-MM-DD`. */
  purchasedOn?: string;
  fields: InstallmentFieldErrors;
}

/**
 * The currency, amount, payment count and purchase date of the form, each parsed or explained by
 * a field message. Shared by the live preview and the save path, so both accept the same input.
 */
export function parseInstallmentDraft(
  values: Pick<InstallmentFormValues, 'currency' | 'amount' | 'installments' | 'purchasedOn'>,
  context: InstallmentDraftContext,
): InstallmentDraft {
  const { timeZone, locale, now } = context;
  const fields: InstallmentFieldErrors = {};

  const currency = toCurrency(values.currency);
  if (currency === undefined) fields.currency = 'creditCards.expense.errors.currencyRequired';

  const parsedAmount = parseAmountField(values.amount, locale);
  let amount = parsedAmount.amount;
  if (parsedAmount.message !== undefined) fields.amount = parsedAmount.message;

  const trimmed = values.installments.trim();
  const parsedCount = INTEGER.test(trimmed) ? Number(trimmed) : Number.NaN;
  let count: number | undefined;
  if (!(parsedCount >= PURCHASE_PAYMENTS_MIN && parsedCount <= INSTALLMENTS_MAX)) {
    fields.installments = 'creditCards.installments.errors.installmentsInvalid';
  } else {
    count = parsedCount;
    if (count >= INSTALLMENTS_MIN && amount !== undefined && amount < BigInt(count)) {
      fields.amount = 'creditCards.installments.errors.amountTooSmall';
      amount = undefined;
    }
  }

  let purchasedOn: string | undefined;
  if (!isCalendarDate(values.purchasedOn)) fields.purchasedOn = 'movements.errors.dateInvalid';
  else if (values.purchasedOn > todayInTimeZone(now, timeZone)) {
    fields.purchasedOn = 'errors.movementDateInFuture';
  } else purchasedOn = values.purchasedOn;

  return {
    ...(currency === undefined ? {} : { currency }),
    ...(amount === undefined ? {} : { amount }),
    ...(count === undefined ? {} : { count }),
    ...(purchasedOn === undefined ? {} : { purchasedOn }),
    fields,
  };
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
  const { categories, timeZone, now } = context;
  const draft = parseInstallmentDraft(values, context);
  const fields: InstallmentFieldErrors = { ...draft.fields };
  const { currency, amount, count, purchasedOn } = draft;

  const category = categories.find((item) => item.id === values.categoryId && !item.archived);
  if (category === undefined) fields.category = 'movements.errors.categoryRequired';

  const note = movementNoteSchema.safeParse(values.note);
  if (!note.success) {
    fields.note = CONTROL_OR_FORMAT.test(values.note)
      ? 'movements.errors.noteInvalidCharacters'
      : 'movements.errors.noteTooLong';
  }

  if (
    Object.keys(fields).length > 0 ||
    currency === undefined ||
    amount === undefined ||
    count === undefined ||
    purchasedOn === undefined ||
    category === undefined ||
    !note.success
  ) {
    return { fields };
  }

  const money = formatMinorUnitsString(amount);
  const noteField = note.data === undefined ? {} : { note: note.data };
  if (count < INSTALLMENTS_MIN) {
    const occurredAt = instantOfDay(purchasedOn, timeZone, now);
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
        purchasedOn,
        ...noteField,
      },
    },
  };
}
