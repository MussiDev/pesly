import type { ErrorMessageKey } from '@/features/auth/form-errors';

export type CardFieldName = 'name' | 'closingDay' | 'dueDay';

/** Catalog paths: the name rules are the account ones, the day and taken-name ones are the cards'. */
export type CardFieldMessage =
  | 'accounts.errors.nameRequired'
  | 'accounts.errors.nameTooLong'
  | 'accounts.errors.nameInvalidCharacters'
  | 'creditCards.errors.dayInvalid'
  | 'creditCards.errors.nameTaken';

export interface CardFormErrors {
  form?: ErrorMessageKey;
  fields?: Partial<Record<CardFieldName, CardFieldMessage>>;
}

/** A whole day of the month from 1 to 31 typed in a numeric field, or `null`. */
export function parseDay(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const day = Number.parseInt(trimmed, 10);
  return day >= 1 && day <= 31 ? day : null;
}
