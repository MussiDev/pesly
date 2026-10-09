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
  createdAt: Date;
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
