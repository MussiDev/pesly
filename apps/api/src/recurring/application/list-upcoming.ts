import { addDays, dueDatesBetween } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import { UPCOMING_HORIZON_DAYS, type UpcomingEntry } from '../domain/recurring-payment';
import { zoneAndToday, type RecurringDependencies } from './dependencies';
import { MaterializeOccurrences } from './materialize-occurrences';

type Deps = Pick<RecurringDependencies, 'payments' | 'occurrences' | 'timeZones' | 'clock'>;

export class ListUpcoming {
  private readonly materialize: MaterializeOccurrences;

  constructor(private readonly deps: Deps) {
    this.materialize = new MaterializeOccurrences(deps);
  }

  /**
   * Overdue (due before today) and pending (due today) rows, plus the dates of every active
   * payment, in any mode, from tomorrow through today + 30 days, projected and not stored.
   */
  async execute(scope: AccessScope): Promise<UpcomingEntry[]> {
    await this.materialize.execute(scope);
    const { today } = await zoneAndToday(this.deps, scope.userId);
    const [payments, pending] = await Promise.all([
      this.deps.payments.list(scope),
      this.deps.occurrences.listPending(scope),
    ]);
    const byId = new Map(payments.map((payment) => [payment.id, payment]));
    const entries: UpcomingEntry[] = [];

    for (const occurrence of pending) {
      const payment = byId.get(occurrence.paymentId);
      if (!payment) continue;
      entries.push({
        kind: occurrence.dueDate < today ? 'overdue' : 'pending',
        dueDate: occurrence.dueDate,
        paymentId: payment.id,
        name: payment.name,
        amount: payment.amount,
        accountId: payment.accountId,
        categoryId: payment.categoryId,
        occurrenceId: occurrence.id,
      });
    }

    const tomorrow = addDays(today, 1);
    const horizon = addDays(today, UPCOMING_HORIZON_DAYS);
    for (const payment of payments) {
      if (payment.status !== 'active') continue;
      const from = payment.scheduleFrom > tomorrow ? payment.scheduleFrom : tomorrow;
      for (const dueDate of dueDatesBetween(payment, from, horizon)) {
        entries.push({
          kind: 'scheduled',
          dueDate,
          paymentId: payment.id,
          name: payment.name,
          amount: payment.amount,
          accountId: payment.accountId,
          categoryId: payment.categoryId,
          occurrenceId: null,
        });
      }
    }

    return entries.sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.paymentId.localeCompare(b.paymentId),
    );
  }
}
