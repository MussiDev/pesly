import type { ErrorMessageKey } from '@/features/auth/form-errors';
import type { ApiFailure } from '@/lib/api-client';

export type MovementFieldName =
  | 'type'
  | 'account'
  | 'destinationAccount'
  | 'category'
  | 'amount'
  | 'destinationAmount'
  | 'occurredAt'
  | 'rate'
  | 'note'
  | 'tags';

/**
 * Catalog paths of what a field can say: the entry-screen validation lives in `movements.errors`;
 * the server codes that are not movement specific are shared with the API errors in `errors`.
 */
export type MovementFieldMessage =
  | 'movements.errors.typeInvalid'
  | 'movements.errors.accountRequired'
  | 'movements.errors.destinationRequired'
  | 'movements.errors.categoryRequired'
  | 'movements.errors.amountInvalid'
  | 'movements.errors.amountNotPositive'
  | 'movements.errors.amountOutOfRange'
  | 'movements.errors.dateInvalid'
  | 'movements.errors.dateSkipped'
  | 'movements.errors.rateInvalid'
  | 'movements.errors.rateRequired'
  | 'movements.errors.noteTooLong'
  | 'movements.errors.noteInvalidCharacters'
  | 'movements.tags.errors.empty'
  | 'movements.tags.errors.tooLong'
  | 'movements.tags.errors.limit'
  // The movement's own wording: the global account-archived message is about a setting.
  | 'movements.errors.accountArchived'
  | 'errors.movementDateInFuture'
  | 'errors.rateRequired'
  | 'errors.movementCategoryKindMismatch'
  | 'errors.categoryArchived'
  | 'errors.movementSameAccount'
  | 'errors.movementCurrencyMismatch'
  | 'errors.exchangeSameCurrency'
  | 'errors.impliedRateOutOfRange';

/** Why the tag field refuses a tag; the field and the entry screen share these wordings. */
export type TagError = 'empty' | 'tooLong' | 'limit';

export function tagErrorMessage(error: TagError): MovementFieldMessage {
  switch (error) {
    case 'empty':
      return 'movements.tags.errors.empty';
    case 'tooLong':
      return 'movements.tags.errors.tooLong';
    case 'limit':
      return 'movements.tags.errors.limit';
  }
}

/** One message above the form and/or one message per field. */
export interface MovementFormErrors {
  form?: ErrorMessageKey;
  fields?: Partial<Record<MovementFieldName, MovementFieldMessage>>;
  /** Too many creations: `seconds` is the wait read from `Retry-After`, absent when it was missing. */
  rateLimit?: { seconds?: number };
}

/** Where a failed `POST /movements` is shown: on the field it is about, or above the form. */
export function movementFailureErrors(failure: ApiFailure): MovementFormErrors {
  switch (failure.code) {
    case 'RATE_REQUIRED':
      return { fields: { rate: 'errors.rateRequired' } };
    case 'MOVEMENT_DATE_IN_FUTURE':
      return { fields: { occurredAt: 'errors.movementDateInFuture' } };
    case 'MOVEMENT_CATEGORY_KIND_MISMATCH':
      return { fields: { category: 'errors.movementCategoryKindMismatch' } };
    case 'CATEGORY_ARCHIVED':
      return { fields: { category: 'errors.categoryArchived' } };
    case 'MOVEMENT_SAME_ACCOUNT':
      return { fields: { destinationAccount: 'errors.movementSameAccount' } };
    case 'MOVEMENT_CURRENCY_MISMATCH':
      return { fields: { destinationAccount: 'errors.movementCurrencyMismatch' } };
    case 'EXCHANGE_SAME_CURRENCY':
      return { fields: { destinationAccount: 'errors.exchangeSameCurrency' } };
    case 'IMPLIED_RATE_OUT_OF_RANGE':
      return { fields: { destinationAmount: 'errors.impliedRateOutOfRange' } };
    case 'ACCOUNT_ARCHIVED':
      return { fields: { account: 'movements.errors.accountArchived' } };
    case 'RATE_LIMITED':
      return {
        rateLimit:
          failure.retryAfterSeconds === undefined ? {} : { seconds: failure.retryAfterSeconds },
      };
    default:
      return { form: failure.messageKey };
  }
}
