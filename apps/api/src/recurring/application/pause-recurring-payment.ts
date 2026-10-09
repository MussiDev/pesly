import type { AccessScope } from '../../shared/access';
import type { RecurringPayment } from '../domain/recurring-payment';
import type { RecurringDependencies } from './dependencies';

export class PauseRecurringPayment {
  constructor(private readonly deps: Pick<RecurringDependencies, 'payments'>) {}

  /** A paused payment materializes nothing and is not projected (AC-13); the cursor is kept. */
  async execute(scope: AccessScope<'write'>, id: string): Promise<RecurringPayment> {
    const payment = await this.deps.payments.get(scope, id);
    return this.deps.payments.setStatus(scope, id, {
      status: 'paused',
      scheduleFrom: payment.scheduleFrom,
    });
  }
}
