import { ACCOUNT_NAME_MAX_LENGTH } from '@pesly/shared';
import type { ErrorMessageKey } from '@/features/auth/form-errors';

export type AccountFieldName = 'name' | 'type' | 'currency' | 'openingBalance';

/**
 * Catalog paths of what a field can say: the account validation messages live in the `accounts`
 * namespace, the duplicate-name answer is shared with the API errors in `errors`.
 */
export type AccountNameMessage =
  | 'accounts.errors.nameRequired'
  | 'accounts.errors.nameTooLong'
  | 'accounts.errors.nameInvalidCharacters';

export type AccountFieldMessage =
  | AccountNameMessage
  | 'accounts.errors.typeRequired'
  | 'accounts.errors.currencyRequired'
  | 'accounts.errors.amountInvalid'
  | 'accounts.errors.amountOutOfRange'
  | 'errors.accountNameTaken';

/** One message above the form and/or one message per field, like the auth forms. */
export interface AccountFormErrors {
  form?: ErrorMessageKey;
  fields?: Partial<Record<AccountFieldName, AccountFieldMessage>>;
  /** The opening-balance limit already formatted for the locale: the `{max}` of the out-of-range message. */
  openingBalanceLimit?: string;
}

// The same Unicode categories as the shared name validator.
const INVISIBLE_OR_SPACE = /[\p{Cc}\p{Cf}\s]/gu;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

/**
 * Why the shared name schema refused `name`: more than `max` characters, nothing visible, or visible text
 * next to a control or format character.
 */
export function nameErrorMessage(
  name: string,
  max: number = ACCOUNT_NAME_MAX_LENGTH,
): AccountNameMessage {
  const normalized = name.normalize('NFC');
  const trimmed = normalized.trim();
  if (Array.from(trimmed).length > max) return 'accounts.errors.nameTooLong';
  if (trimmed.replace(INVISIBLE_OR_SPACE, '') === '') return 'accounts.errors.nameRequired';
  // Checked before trimming, like the shared schema: trim would hide an edge control character.
  return CONTROL_OR_FORMAT.test(normalized)
    ? 'accounts.errors.nameInvalidCharacters'
    : 'accounts.errors.nameRequired';
}
