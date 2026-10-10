import { addDays, dueDatesBetween } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import { MATERIALIZE_LOOKBACK_DAYS } from '../domain/recurring-payment';
import { zoneAndToday, type RecurringDependencies } from './dependencies';
import type { NewOccurrence } from './ports/occurrence-repository';

export class MaterializeOccurrences {
  constructor(
    private readonly deps: Pick<
      RecurringDependencies,
      'payments' | 'occurrences' | 'timeZones' | 'clock'
    >,
  ) {}

  /**
   * Stores one pending occurrence per due date up to today for the caller's active
   * confirmation-mode payments. Safe to repeat and to run concurrently: the unique key and the
   * insert-or-ignore leave one row per date, and resolved rows are never recreated (AC-06, AC-09).
   * Automatic payments get pending rows only for the dates before `autoRecordingFrom`; the
   * recording job owns the later ones (DISC-001-08b, FR-05).
   */
  async execute(scope: AccessScope): Promise<void> {
    const { today } = await zoneAndToday(this.deps, scope.userId);
    const floor = addDays(today, -MATERIALIZE_LOOKBACK_DAYS);
    const rows: NewOccurrence[] = [];
    for (const payment of await this.deps.payments.list(scope)) {
      if (payment.status !== 'active') continue;
      const from = [payment.scheduleFrom, payment.startDate, floor].reduce((a, b) =>
        a > b ? a : b,
      );
      const dayBeforeRecording = addDays(payment.autoRecordingFrom, -1);
      const to =
        payment.mode === 'automatic' && dayBeforeRecording < today ? dayBeforeRecording : today;
      for (const dueDate of dueDatesBetween(payment, from, to)) {
        rows.push({ paymentId: payment.id, ownerId: scope.userId, dueDate });
      }
    }
    await this.deps.occurrences.insertIgnore(rows);
  }
}
