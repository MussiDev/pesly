import type { AccessScope } from '../../shared/access';
import type { RecurringPayment } from '../domain/recurring-payment';
import { zoneAndToday, type RecurringDependencies } from './dependencies';

export class ResumeRecurringPayment {
  constructor(
    private readonly deps: Pick<RecurringDependencies, 'payments' | 'timeZones' | 'clock'>,
  ) {}

  /** Dates missed while paused are never created: the cursor moves to today in the user's zone (AC-14). */
  async execute(scope: AccessScope<'write'>, id: string): Promise<RecurringPayment> {
    await this.deps.payments.get(scope, id);
    const { today } = await zoneAndToday(this.deps, scope.userId);
    return this.deps.payments.setStatus(scope, id, 'active', today);
  }
}
