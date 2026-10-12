import type { BudgetsUserTimeZone } from '../../budgets';
import type { RecurringUserTimeZone } from '../../recurring';

/**
 * The zone the request already read, served to the budgets and recurring use cases so they do not
 * read it again. It answers for its own user only: any other id is a bug and fails closed.
 */
export class ContextTimeZones implements BudgetsUserTimeZone, RecurringUserTimeZone {
  constructor(
    private readonly userId: string,
    private readonly zone: string,
  ) {}

  timeZoneOf(userId: string): Promise<string> {
    if (userId !== this.userId) {
      return Promise.reject(new Error('The request time zone was asked for another user'));
    }
    return Promise.resolve(this.zone);
  }
}
