import type { CreditCard } from '../../domain/credit-card';

/** A card with at least one debit account, with its owner and the owner's time zone. */
export interface AutomaticDebitEntry {
  ownerId: string;
  timeZone: string;
  card: CreditCard;
}

/**
 * Cross-owner read for the system job (the one approved exception to owner scoping): the cards of
 * existing users that have an automatic debit account in some currency.
 */
export interface AutomaticDebitSource {
  /** Up to `limit` entries ordered by card id, after `afterId` (`null`: from the start). */
  page(afterId: string | null, limit: number): Promise<AutomaticDebitEntry[]>;
}
