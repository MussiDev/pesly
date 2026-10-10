import type { RecurringPayment } from '../../domain/recurring-payment';
import type { NoticePublisherLanguage } from './notice-publisher';

/** An active automatic payment with the owner it belongs to, the owner's time zone and language. */
export interface AutomaticPaymentEntry {
  ownerId: string;
  timeZone: string;
  /** The language the owner's notices are written in. */
  language: NoticePublisherLanguage;
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
