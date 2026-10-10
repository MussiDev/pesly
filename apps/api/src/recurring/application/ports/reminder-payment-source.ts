import type { RecurringPayment } from '../../domain/recurring-payment';
import type { NoticePublisherLanguage } from './notice-publisher';

/** An active payment of any mode with its owner, the owner's time zone and language. */
export interface ReminderEntry {
  ownerId: string;
  timeZone: string;
  language: NoticePublisherLanguage;
  payment: RecurringPayment;
}

/**
 * Cross-owner read for the reminder job (the same approved exception as the automatic payment
 * source): the active payments of existing users, never paused or deleted ones.
 */
export interface ReminderPaymentSource {
  /** Up to `limit` entries ordered by payment id, after `afterId` (`null`: from the start). */
  page(afterId: string | null, limit: number): Promise<ReminderEntry[]>;
}
