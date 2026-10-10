import type { AccessScope } from '../../shared/access';
import type { RecurringPayment } from '../domain/recurring-payment';
import { zoneAndToday, type RecurringDependencies } from './dependencies';

export class ResumeRecurringPayment {
  constructor(
    private readonly deps: Pick<RecurringDependencies, 'payments' | 'timeZones' | 'clock'>,
  ) {}

  /**
   * Dates missed while paused are never created and never recorded: both the schedule cursor and
   * the auto-recording start day move to today in the user's zone (AC-14, DISC-001-08b AC-07).
   */
  async execute(scope: AccessScope<'write'>, id: string): Promise<RecurringPayment> {
    await this.deps.payments.get(scope, id);
    const { today } = await zoneAndToday(this.deps, scope.userId);
    return this.deps.payments.setStatus(scope, id, {
      status: 'active',
      scheduleFrom: today,
      autoRecordingFrom: today,
    });
  }
}
