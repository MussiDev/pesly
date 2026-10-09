import type { RecurringStatus } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';
import type { RecurringPayment } from '../../domain/recurring-payment';

export type NewRecurringPayment = Omit<RecurringPayment, 'id' | 'status' | 'createdAt'>;

/** The editable fields, each optional; `scheduleFrom` moves when the schedule itself changes. */
export type RecurringPaymentChanges = Partial<NewRecurringPayment>;

/** Every method answers `ResourceNotFound` for a missing or foreign payment. */
export interface RecurringPaymentRepository {
  create(scope: AccessScope<'write'>, data: NewRecurringPayment): Promise<RecurringPayment>;
  get(scope: AccessScope, id: string): Promise<RecurringPayment>;
  /** Oldest first. */
  list(scope: AccessScope): Promise<RecurringPayment[]>;
  count(scope: AccessScope): Promise<number>;
  update(
    scope: AccessScope<'write'>,
    id: string,
    changes: RecurringPaymentChanges,
  ): Promise<RecurringPayment>;
  setStatus(
    scope: AccessScope<'write'>,
    id: string,
    status: RecurringStatus,
    scheduleFrom: string,
  ): Promise<RecurringPayment>;
  /** The payment's occurrences go with it; recorded movements stay. */
  delete(scope: AccessScope<'write'>, id: string): Promise<void>;
}
