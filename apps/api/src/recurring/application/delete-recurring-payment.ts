import type { AccessScope } from '../../shared/access';
import type { RecurringDependencies } from './dependencies';

export class DeleteRecurringPayment {
  constructor(private readonly deps: Pick<RecurringDependencies, 'payments'>) {}

  /** Its occurrences go with it; movements already recorded stay (AC-15). */
  execute(scope: AccessScope<'write'>, id: string): Promise<void> {
    return this.deps.payments.delete(scope, id);
  }
}
