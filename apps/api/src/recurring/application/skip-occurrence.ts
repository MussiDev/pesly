import type { AccessScope } from '../../shared/access';
import type { RecurringOccurrence } from '../domain/recurring-payment';
import type { RecurringDependencies } from './dependencies';

export class SkipOccurrence {
  constructor(private readonly deps: Pick<RecurringDependencies, 'occurrences'>) {}

  /** Marks the occurrence skipped without recording anything; the date is not materialized again (AC-09). */
  execute(scope: AccessScope<'write'>, id: string): Promise<RecurringOccurrence> {
    return this.deps.occurrences.withLockedPending(scope, id, () =>
      Promise.resolve({ status: 'skipped' }),
    );
  }
}
