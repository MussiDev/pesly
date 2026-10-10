import { randomUUID } from 'node:crypto';
import { AppError, dateInTimeZone } from '@pesly/shared';
import type { Clock } from '../../src/recurring/application/ports/clock';
import type {
  AutomaticPaymentEntry,
  AutomaticPaymentSource,
} from '../../src/recurring/application/ports/automatic-payment-source';
import type {
  ExpenseRecorder,
  ExpenseToRecord,
} from '../../src/recurring/application/ports/expense-recorder';
import type {
  NewOccurrence,
  OccurrenceRepository,
  OccurrenceResolution,
} from '../../src/recurring/application/ports/occurrence-repository';
import type {
  NewRecurringPayment,
  RecurringPaymentChanges,
  RecurringPaymentRepository,
  RecurringStatusChanges,
} from '../../src/recurring/application/ports/recurring-payment-repository';
import type { UserTimeZone } from '../../src/recurring/application/ports/user-time-zone';
import { OccurrenceNotPending } from '../../src/recurring/domain/errors';
import type {
  RecurringOccurrence,
  RecurringPayment,
} from '../../src/recurring/domain/recurring-payment';
import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../src/shared/access';

export { readScopeFor, writeScopeFor } from '../accounts/fakes';

export class FakeClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return this.current;
  }
}

export class FakeTimeZones implements UserTimeZone {
  zone = 'America/Argentina/Buenos_Aires';
  /** Per-user zones that win over `zone`. */
  readonly byUser = new Map<string, string>();

  timeZoneOf(userId?: string): Promise<string> {
    return Promise.resolve(
      (userId === undefined ? undefined : this.byUser.get(userId)) ?? this.zone,
    );
  }
}

interface OccurrenceRow {
  ownerId: string;
  occurrence: RecurringOccurrence;
}

/** In-memory occurrences: unique per (payment, due date), visible only to their owner. */
export class InMemoryOccurrences implements OccurrenceRepository {
  readonly rows: OccurrenceRow[] = [];

  insertIgnore(rows: readonly NewOccurrence[]): Promise<void> {
    for (const row of rows) {
      const exists = this.rows.some(
        (item) =>
          item.occurrence.paymentId === row.paymentId && item.occurrence.dueDate === row.dueDate,
      );
      if (exists) continue;
      this.rows.push({
        ownerId: row.ownerId,
        occurrence: {
          id: randomUUID(),
          paymentId: row.paymentId,
          dueDate: row.dueDate,
          status: 'pending',
          confirmedAmount: null,
          movementId: null,
          resolvedAt: null,
          createdAt: new Date(),
        },
      });
    }
    return Promise.resolve();
  }

  listPending(scope: AccessScope): Promise<RecurringOccurrence[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.ownerId === scope.userId && row.occurrence.status === 'pending')
        .map((row) => row.occurrence)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    );
  }

  listRecordable(
    scope: AccessScope,
    paymentId: string,
    from: string,
    to: string,
  ): Promise<RecurringOccurrence[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (row) =>
            row.ownerId === scope.userId &&
            row.occurrence.paymentId === paymentId &&
            row.occurrence.status === 'pending' &&
            row.occurrence.dueDate >= from &&
            row.occurrence.dueDate <= to,
        )
        .map((row) => row.occurrence)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    );
  }

  deletePendingFor(scope: AccessScope<'write'>, paymentId: string): Promise<void> {
    this.removeWhere(
      (row) =>
        row.ownerId === scope.userId &&
        row.occurrence.paymentId === paymentId &&
        row.occurrence.status === 'pending',
    );
    return Promise.resolve();
  }

  /** The payment's occurrences go with it, like the database cascade. */
  removeWhere(predicate: (row: OccurrenceRow) => boolean): void {
    for (let index = this.rows.length - 1; index >= 0; index--) {
      const row = this.rows[index];
      if (row && predicate(row)) this.rows.splice(index, 1);
    }
  }

  async withLockedPending(
    scope: AccessScope<'write'>,
    id: string,
    fn: (occurrence: RecurringOccurrence) => Promise<OccurrenceResolution>,
  ): Promise<RecurringOccurrence> {
    const row = notFoundUnlessAllowed(
      this.rows.find((item) => item.ownerId === scope.userId && item.occurrence.id === id),
    );
    if (row.occurrence.status !== 'pending') throw new OccurrenceNotPending();
    const resolution = await fn(row.occurrence);
    row.occurrence = {
      ...row.occurrence,
      status: resolution.status,
      confirmedAmount: resolution.status === 'confirmed' ? resolution.confirmedAmount : null,
      movementId: resolution.status === 'confirmed' ? resolution.movementId : null,
      resolvedAt: new Date(),
    };
    return row.occurrence;
  }
}

interface PaymentRow {
  ownerId: string;
  payment: RecurringPayment;
}

/** In-memory payments; accounts and categories must be registered per owner, like the composite keys. */
export class InMemoryPayments implements RecurringPaymentRepository {
  readonly rows: PaymentRow[] = [];
  private readonly accounts = new Set<string>();
  private readonly categories = new Set<string>();

  constructor(private readonly occurrences: InMemoryOccurrences) {}

  own(ownerId: string, accountId: string, categoryId: string): void {
    this.accounts.add(`${ownerId}|${accountId}`);
    this.categories.add(`${ownerId}|${categoryId}`);
  }

  private find(scope: AccessScope, id: string): PaymentRow | undefined {
    return this.rows.find((row) => row.ownerId === scope.userId && row.payment.id === id);
  }

  create(scope: AccessScope<'write'>, data: NewRecurringPayment): Promise<RecurringPayment> {
    const owned =
      this.accounts.has(`${scope.userId}|${data.accountId}`) &&
      this.categories.has(`${scope.userId}|${data.categoryId}`);
    if (!owned) {
      return Promise.reject(Object.assign(new Error('foreign key'), { cause: { code: '23503' } }));
    }
    const payment: RecurringPayment = {
      ...data,
      id: randomUUID(),
      status: 'active',
      createdAt: new Date(),
    };
    this.rows.push({ ownerId: scope.userId, payment });
    return Promise.resolve(payment);
  }

  get(scope: AccessScope, id: string): Promise<RecurringPayment> {
    return Promise.resolve(notFoundUnlessAllowed(this.find(scope, id)?.payment));
  }

  list(scope: AccessScope): Promise<RecurringPayment[]> {
    return Promise.resolve(
      this.rows.filter((row) => row.ownerId === scope.userId).map((row) => row.payment),
    );
  }

  count(scope: AccessScope): Promise<number> {
    return Promise.resolve(this.rows.filter((row) => row.ownerId === scope.userId).length);
  }

  update(
    scope: AccessScope<'write'>,
    id: string,
    changes: RecurringPaymentChanges,
  ): Promise<RecurringPayment> {
    const row = notFoundUnlessAllowed(this.find(scope, id));
    row.payment = { ...row.payment, ...changes };
    return Promise.resolve(row.payment);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- keeps a not-found a rejection, like the database repository
  async setStatus(
    scope: AccessScope<'write'>,
    id: string,
    changes: RecurringStatusChanges,
  ): Promise<RecurringPayment> {
    const row = notFoundUnlessAllowed(this.find(scope, id));
    row.payment = {
      ...row.payment,
      status: changes.status,
      scheduleFrom: changes.scheduleFrom,
      ...(changes.autoRecordingFrom === undefined
        ? {}
        : { autoRecordingFrom: changes.autoRecordingFrom }),
    };
    return row.payment;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- keeps a not-found a rejection, like the database repository
  async delete(scope: AccessScope<'write'>, id: string): Promise<void> {
    const row = notFoundUnlessAllowed(this.find(scope, id));
    this.rows.splice(this.rows.indexOf(row), 1);
    this.occurrences.removeWhere((item) => item.occurrence.paymentId === id);
  }
}

export interface RecordedExpense extends ExpenseToRecord {
  ownerId: string;
  id: string;
}

/** Stores expenses in memory; refuses a future date like the movements rules do. */
export class FakeExpenseRecorder implements ExpenseRecorder {
  readonly expenses: RecordedExpense[] = [];
  /** When set, the next calls reject with it and store nothing. */
  failWith: Error | null = null;
  /** The owner's zone: like the movements rules, "future" means a later calendar day there. */
  zone = 'America/Argentina/Buenos_Aires';

  constructor(private readonly clock: Clock) {}

  private isFuture(occurredAt: Date): boolean {
    return dateInTimeZone(occurredAt, this.zone) > dateInTimeZone(this.clock.now(), this.zone);
  }

  record(
    scope: AccessScope<'write'>,
    expense: ExpenseToRecord,
  ): Promise<{ id: string; occurredAt: Date }> {
    if (this.failWith) return Promise.reject(this.failWith);
    if (this.isFuture(expense.occurredAt)) {
      return Promise.reject(new AppError('MOVEMENT_DATE_IN_FUTURE'));
    }
    const id = randomUUID();
    this.expenses.push({ ownerId: scope.userId, id, ...expense });
    return Promise.resolve({ id, occurredAt: expense.occurredAt });
  }

  /** Idempotent by id: a repeat returns the stored expense; another owner's id is not found. */
  recordOnce(
    scope: AccessScope<'write'>,
    id: string,
    expense: ExpenseToRecord,
  ): Promise<{ id: string; occurredAt: Date }> {
    const stored = this.expenses.find((e) => e.id === id);
    if (stored) {
      if (stored.ownerId !== scope.userId) return Promise.reject(new ResourceNotFound());
      return Promise.resolve({ id, occurredAt: stored.occurredAt });
    }
    if (this.failWith) return Promise.reject(this.failWith);
    if (this.isFuture(expense.occurredAt)) {
      return Promise.reject(new AppError('MOVEMENT_DATE_IN_FUTURE'));
    }
    this.expenses.push({ ownerId: scope.userId, id, ...expense });
    return Promise.resolve({ id, occurredAt: expense.occurredAt });
  }
}

/** Active automatic payments of every owner, keyset-paged by id, with the owner's zone. */
export class FakeAutomaticPaymentSource implements AutomaticPaymentSource {
  constructor(
    private readonly payments: InMemoryPayments,
    private readonly timeZones: FakeTimeZones,
  ) {}

  async page(afterId: string | null, limit: number): Promise<AutomaticPaymentEntry[]> {
    const rows = this.payments.rows
      .filter(
        (row) =>
          row.payment.status === 'active' &&
          row.payment.mode === 'automatic' &&
          (afterId === null || row.payment.id > afterId),
      )
      .sort((a, b) => a.payment.id.localeCompare(b.payment.id))
      .slice(0, limit);
    return Promise.all(
      rows.map(async (row) => ({
        ownerId: row.ownerId,
        timeZone: await this.timeZones.timeZoneOf(row.ownerId),
        payment: row.payment,
      })),
    );
  }
}

export function recurringFakes(now: string) {
  const clock = new FakeClock(new Date(now));
  const occurrences = new InMemoryOccurrences();
  const payments = new InMemoryPayments(occurrences);
  const timeZones = new FakeTimeZones();
  const expenses = new FakeExpenseRecorder(clock);
  const source = new FakeAutomaticPaymentSource(payments, timeZones);
  return { clock, occurrences, payments, timeZones, expenses, source };
}
