import { and, asc, count, eq } from 'drizzle-orm';
import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import { violatedConstraint } from '../../../shared/db/pg-errors';
import type {
  NewRecurringPayment,
  RecurringPaymentChanges,
  RecurringPaymentRepository,
  RecurringStatusChanges,
} from '../../application/ports/recurring-payment-repository';
import type { RecurringPayment } from '../../domain/recurring-payment';
import { recurringPayments } from './schema';

const paymentColumns = {
  id: recurringPayments.id,
  name: recurringPayments.name,
  amount: recurringPayments.amount,
  accountId: recurringPayments.accountId,
  categoryId: recurringPayments.categoryId,
  frequency: recurringPayments.frequency,
  weekday: recurringPayments.weekday,
  dayOfMonth: recurringPayments.dayOfMonth,
  month: recurringPayments.month,
  startDate: recurringPayments.startDate,
  endDate: recurringPayments.endDate,
  mode: recurringPayments.mode,
  status: recurringPayments.status,
  scheduleFrom: recurringPayments.scheduleFrom,
  autoRecordingFrom: recurringPayments.autoRecordingFrom,
  reminderDays: recurringPayments.reminderDays,
  createdAt: recurringPayments.createdAt,
};

/**
 * The composite keys to accounts and categories include the owner, so a foreign or income id
 * violates a key (23503). It answers like a missing id, never revealing that the id exists (404).
 */
function foreignReferenceAsNotFound(error: unknown): unknown {
  return violatedConstraint(error, '23503') === undefined ? error : new ResourceNotFound();
}

const ownPayment = (scope: AccessScope, id: string) =>
  and(eq(recurringPayments.id, id), scopedTo(scope, { owner: recurringPayments.ownerId }));

export class DrizzleRecurringPaymentRepository implements RecurringPaymentRepository {
  constructor(private readonly db: Database) {}

  async create(scope: AccessScope<'write'>, data: NewRecurringPayment): Promise<RecurringPayment> {
    const [row] = await this.db
      .insert(recurringPayments)
      .values({ ...data, ownerId: scope.userId })
      .returning(paymentColumns)
      .catch((error: unknown) => {
        throw foreignReferenceAsNotFound(error);
      });
    if (!row) throw new Error('Inserting a recurring payment returned no row');
    return row;
  }

  async get(scope: AccessScope, id: string): Promise<RecurringPayment> {
    const [row] = await this.db
      .select(paymentColumns)
      .from(recurringPayments)
      .where(ownPayment(scope, id))
      .limit(1);
    return notFoundUnlessAllowed(row);
  }

  list(scope: AccessScope): Promise<RecurringPayment[]> {
    return this.db
      .select(paymentColumns)
      .from(recurringPayments)
      .where(scopedTo(scope, { owner: recurringPayments.ownerId }))
      .orderBy(asc(recurringPayments.createdAt), asc(recurringPayments.id));
  }

  async count(scope: AccessScope): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(recurringPayments)
      .where(scopedTo(scope, { owner: recurringPayments.ownerId }));
    return row?.total ?? 0;
  }

  async update(
    scope: AccessScope<'write'>,
    id: string,
    changes: RecurringPaymentChanges,
  ): Promise<RecurringPayment> {
    const [row] = await this.db
      .update(recurringPayments)
      .set({ ...changes, updatedAt: new Date() })
      .where(ownPayment(scope, id))
      .returning(paymentColumns)
      .catch((error: unknown) => {
        throw foreignReferenceAsNotFound(error);
      });
    return notFoundUnlessAllowed(row);
  }

  async setStatus(
    scope: AccessScope<'write'>,
    id: string,
    changes: RecurringStatusChanges,
  ): Promise<RecurringPayment> {
    const [row] = await this.db
      .update(recurringPayments)
      .set({
        status: changes.status,
        scheduleFrom: changes.scheduleFrom,
        ...(changes.autoRecordingFrom === undefined
          ? {}
          : { autoRecordingFrom: changes.autoRecordingFrom }),
        updatedAt: new Date(),
      })
      .where(ownPayment(scope, id))
      .returning(paymentColumns);
    return notFoundUnlessAllowed(row);
  }

  async delete(scope: AccessScope<'write'>, id: string): Promise<void> {
    const deleted = await this.db
      .delete(recurringPayments)
      .where(ownPayment(scope, id))
      .returning({ id: recurringPayments.id });
    notFoundUnlessAllowed(deleted[0]);
  }
}
