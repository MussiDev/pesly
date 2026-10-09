import type { RecurringPayment } from '../../domain/recurring-payment';

/** An active automatic payment with the owner it belongs to and the owner's time zone. */
export interface AutomaticPaymentEntry {
  ownerId: string;
  timeZone: string;
  payment: RecurringPayment;
}

/**
 * Cross-owner read for the system job (the one approved exception to owner scoping): the active
 * automatic payments of existing users, never paused or deleted ones.
 */
export interface AutomaticPaymentSource {
  /** Up to `limit` entries ordered by payment id, after `afterId` (`null`: from the start). */
  page(afterId: string | null, limit: number): Promise<AutomaticPaymentEntry[]>;
}
