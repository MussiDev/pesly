import { nextDueDate } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { RecurringPayment } from '../domain/recurring-payment';
import { zoneAndToday, type RecurringDependencies } from './dependencies';

export interface RecurringPaymentView {
  payment: RecurringPayment;
  /** The next due date from today, or `null` when paused or ended. */
  nextDueDate: string | null;
}

type Deps = Pick<RecurringDependencies, 'payments' | 'timeZones' | 'clock'>;

function nextDueDateOf(payment: RecurringPayment, today: string): string | null {
  if (payment.status === 'paused') return null;
  return nextDueDate(payment, payment.scheduleFrom > today ? payment.scheduleFrom : today);
}

export class ListRecurringPayments {
  constructor(private readonly deps: Deps) {}

  async execute(scope: AccessScope): Promise<RecurringPaymentView[]> {
    const { today } = await zoneAndToday(this.deps, scope.userId);
    const payments = await this.deps.payments.list(scope);
    return payments.map((payment) => ({ payment, nextDueDate: nextDueDateOf(payment, today) }));
  }
}

export class GetRecurringPayment {
  constructor(private readonly deps: Deps) {}

  async execute(scope: AccessScope, id: string): Promise<RecurringPaymentView> {
    const { today } = await zoneAndToday(this.deps, scope.userId);
    const payment = await this.deps.payments.get(scope, id);
    return { payment, nextDueDate: nextDueDateOf(payment, today) };
  }
}
