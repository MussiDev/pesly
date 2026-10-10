import type { RecurringFrequencyValue, RecurringMode, RecurringStatus } from '@pesly/shared';

/** A recurring payment rule. Money is in minor units; dates are `YYYY-MM-DD` calendar days. */
export interface RecurringPayment {
  id: string;
  name: string;
  amount: bigint;
  accountId: string;
  categoryId: string;
  frequency: RecurringFrequencyValue;
  weekday: number | null;
  dayOfMonth: number | null;
  month: number | null;
  startDate: string;
  endDate: string | null;
  mode: RecurringMode;
  status: RecurringStatus;
  /** The day the schedule counts from: creation, resume or the last schedule edit. */
  scheduleFrom: string;
  /**
   * First day whose due dates an automatic payment may record without the user: set on creation,
   * resume, switch to automatic and schedule edits. Earlier due dates stay pending (DISC-001-08b).
   */
  autoRecordingFrom: string;
  createdAt: Date;
}

/** Defensive per-user cap that keeps the on-read materialization bounded (NFR-02, NFR-03). */
export const MAX_RECURRING_PAYMENTS = 200;

/** How far back materialization looks, so an old payment cannot flood the table. */
export const MATERIALIZE_LOOKBACK_DAYS = 366;

/** How far ahead the upcoming list projects scheduled dates (AC-11). */
export const UPCOMING_HORIZON_DAYS = 30;

/** An upcoming list entry; the presenter turns `amount` into the API decimal string. */
export interface UpcomingEntry {
  kind: 'pending' | 'overdue' | 'scheduled';
  dueDate: string;
  paymentId: string;
  name: string;
  amount: bigint;
  accountId: string;
  categoryId: string;
  /** Set for pending and overdue entries, `null` for scheduled ones. */
  occurrenceId: string | null;
}

export type OccurrenceStatus = 'pending' | 'confirmed' | 'skipped';

/** One due date of a payment. */
export interface RecurringOccurrence {
  id: string;
  paymentId: string;
  dueDate: string;
  status: OccurrenceStatus;
  confirmedAmount: bigint | null;
  movementId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}
