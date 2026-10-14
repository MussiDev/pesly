import type { ApiFailure } from '@/lib/api-client';
import type { SetBalanceFailure } from './components/set-balance-dialog';

/** The account is gone for this user: the dialog closes and the list is read again. */
export const ACCOUNT_GONE = 'gone';

/**
 * What `POST /accounts/:id/balance` refused, as the dialog shows it. The API answers 422
 * `VALIDATION_FAILED` on `params.id` for a credit card, and 400 on `body.balance` for an amount the
 * client-side check let through; a wrong, missing or used code is `TOTP_INVALID`.
 */
export function mapSetBalanceFailure(failure: ApiFailure): SetBalanceFailure | typeof ACCOUNT_GONE {
  switch (failure.code) {
    case 'TOTP_INVALID':
      return { field: 'code', message: `errors.${failure.messageKey}` };
    case 'ACCOUNT_ARCHIVED':
      return { field: 'form', message: 'accounts.setBalance.errors.archived' };
    case 'NOT_FOUND':
      return ACCOUNT_GONE;
    case 'VALIDATION_FAILED':
      if (failure.fields?.includes('params.id')) {
        return { field: 'form', message: 'accounts.setBalance.errors.creditCard' };
      }
      if (failure.fields?.includes('body.balance')) {
        return { field: 'balance', message: 'accounts.errors.amountOutOfRange' };
      }
      if (failure.fields?.includes('body.note')) {
        return { field: 'form', message: 'accounts.setBalance.errors.noteInvalid' };
      }
      return { field: 'form', message: `errors.${failure.messageKey}` };
    default:
      // RATE_LIMITED carries the existing too-many-attempts message; NETWORK keeps the dialog as it was.
      return { field: 'form', message: `errors.${failure.messageKey}` };
  }
}
