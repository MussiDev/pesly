import type { RecurringPaymentResponse, UpcomingResponse } from '@pesly/shared';
import type { RecurringPaymentView } from '../../application/list-recurring-payments';
import type { RecurringOccurrence, UpcomingEntry } from '../../domain/recurring-payment';

export function presentRecurringPayment({
  payment,
  nextDueDate,
}: RecurringPaymentView): RecurringPaymentResponse {
  return {
    id: payment.id,
    name: payment.name,
    amount: payment.amount.toString(),
    accountId: payment.accountId,
    categoryId: payment.categoryId,
    frequency: payment.frequency,
    weekday: payment.weekday,
    dayOfMonth: payment.dayOfMonth,
    month: payment.month,
    startDate: payment.startDate,
    endDate: payment.endDate,
    mode: payment.mode,
    status: payment.status,
    reminderDays: payment.reminderDays,
    nextDueDate,
  };
}

export function presentUpcoming(entries: readonly UpcomingEntry[]): UpcomingResponse {
  return {
    items: entries.map((entry) => ({ ...entry, amount: entry.amount.toString() })),
  };
}

/** What confirm and skip answer; the web client ignores the body, so it stays small. */
export interface OccurrenceResponse {
  id: string;
  paymentId: string;
  dueDate: string;
  status: 'pending' | 'confirmed' | 'skipped';
  confirmedAmount: string | null;
  movementId: string | null;
}

export function presentOccurrence(occurrence: RecurringOccurrence): OccurrenceResponse {
  return {
    id: occurrence.id,
    paymentId: occurrence.paymentId,
    dueDate: occurrence.dueDate,
    status: occurrence.status,
    confirmedAmount: occurrence.confirmedAmount?.toString() ?? null,
    movementId: occurrence.movementId,
  };
}
