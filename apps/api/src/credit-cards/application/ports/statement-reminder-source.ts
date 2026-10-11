import type { CreditCard } from '../../domain/credit-card';

export type ReminderLanguage = 'es' | 'en';

/** A card with its owner, the owner's time zone and the owner's language. */
export interface StatementReminderEntry {
  ownerId: string;
  timeZone: string;
  language: ReminderLanguage;
  card: CreditCard;
}

/**
 * Cross-owner read for the system job (an approved exception to owner scoping): every card of
 * existing users.
 */
export interface StatementReminderSource {
  /** Up to `limit` entries ordered by card id, after `afterId` (`null`: from the start). */
  page(afterId: string | null, limit: number): Promise<StatementReminderEntry[]>;
}
