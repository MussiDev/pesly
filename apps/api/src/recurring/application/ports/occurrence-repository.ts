import type { AccessScope } from '../../../shared/access';
import type { RecurringOccurrence } from '../../domain/recurring-payment';

export interface NewOccurrence {
  paymentId: string;
  ownerId: string;
  dueDate: string;
}

/** How a pending occurrence ends; the repository stores it together with the resolution time. */
export type OccurrenceResolution =
  { status: 'confirmed'; confirmedAmount: bigint; movementId: string } | { status: 'skipped' };

export interface OccurrenceRepository {
  /** One row per (payment, due date): rows that already exist are left as they are. */
  insertIgnore(rows: readonly NewOccurrence[]): Promise<void>;
  /** The caller's pending occurrences, ordered by due date. */
  listPending(scope: AccessScope): Promise<RecurringOccurrence[]>;
  /** Used when a schedule edit invalidates what was materialized; resolved rows stay. */
  deletePendingFor(scope: AccessScope<'write'>, paymentId: string): Promise<void>;
  /**
   * Runs `fn` while holding the pending occurrence's row lock in a transaction, then stores the
   * resolution `fn` returns. A throw inside `fn` rolls back and leaves the row pending. Raises
   * `ResourceNotFound` for a missing or foreign id and `OccurrenceNotPending` for a resolved one.
   */
  withLockedPending(
    scope: AccessScope<'write'>,
    id: string,
    fn: (occurrence: RecurringOccurrence) => Promise<OccurrenceResolution>,
  ): Promise<RecurringOccurrence>;
}
