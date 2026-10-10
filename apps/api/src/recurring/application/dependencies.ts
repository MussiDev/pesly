import { todayInTimeZone } from '@pesly/shared';
import type { Clock } from './ports/clock';
import type { ExpenseRecorder } from './ports/expense-recorder';
import type { OccurrenceRepository } from './ports/occurrence-repository';
import type { RecurringPaymentRepository } from './ports/recurring-payment-repository';
import type { UserTimeZone } from './ports/user-time-zone';

export interface RecurringDependencies {
  payments: RecurringPaymentRepository;
  occurrences: OccurrenceRepository;
  timeZones: UserTimeZone;
  clock: Clock;
  expenses: ExpenseRecorder;
}

/** The caller's stored time zone and their calendar date in it (PRD 01 FR-24). */
export async function zoneAndToday(
  deps: Pick<RecurringDependencies, 'timeZones' | 'clock'>,
  userId: string,
): Promise<{ timeZone: string; today: string }> {
  const timeZone = await deps.timeZones.timeZoneOf(userId);
  return { timeZone, today: todayInTimeZone(deps.clock.now(), timeZone) };
}
