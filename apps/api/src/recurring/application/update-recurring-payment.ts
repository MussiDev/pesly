import { AppError } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { RecurringPayment } from '../domain/recurring-payment';
import type { CreateRecurringPaymentInput } from './create-recurring-payment';
import { zoneAndToday, type RecurringDependencies } from './dependencies';
import type { RecurringPaymentChanges } from './ports/recurring-payment-repository';

export type UpdateRecurringPaymentInput = Partial<{
  [K in keyof CreateRecurringPaymentInput]: CreateRecurringPaymentInput[K] | undefined;
}>;

const SCHEDULE_FIELDS = [
  'frequency',
  'weekday',
  'dayOfMonth',
  'month',
  'startDate',
  'endDate',
] as const;

export class UpdateRecurringPayment {
  constructor(
    private readonly deps: Pick<
      RecurringDependencies,
      'payments' | 'occurrences' | 'timeZones' | 'clock'
    >,
  ) {}

  /**
   * Applies a partial change. A change to any schedule field deletes the payment's pending
   * occurrences (materialization recreates them from the new rule); resolved ones stay (AC-12).
   * Fields that do not belong to the resulting frequency are cleared. Switching to automatic or
   * editing the schedule moves the auto-recording start day to today in the owner's zone, so the
   * dates before it stay pending for the user.
   */
  async execute(
    scope: AccessScope<'write'>,
    id: string,
    input: UpdateRecurringPaymentInput,
  ): Promise<RecurringPayment> {
    const current = await this.deps.payments.get(scope, id);
    const frequency = input.frequency ?? current.frequency;
    const weekday = frequency === 'weekly' ? (input.weekday ?? current.weekday) : null;
    const dayOfMonth = frequency === 'weekly' ? null : (input.dayOfMonth ?? current.dayOfMonth);
    const month = frequency === 'yearly' ? (input.month ?? current.month) : null;
    const startDate = input.startDate ?? current.startDate;
    const endDate = input.endDate ?? current.endDate;

    const invalid = [
      ...(frequency === 'weekly' && weekday === null ? ['weekday'] : []),
      ...(frequency !== 'weekly' && dayOfMonth === null ? ['dayOfMonth'] : []),
      ...(frequency === 'yearly' && month === null ? ['month'] : []),
      ...(endDate !== null && endDate < startDate ? ['endDate'] : []),
    ];
    if (invalid.length > 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        'VALIDATION_FAILED',
        invalid.map((field) => `body.${field}`),
      );
    }

    const next = { frequency, weekday, dayOfMonth, month, startDate, endDate };
    const scheduleChanged = SCHEDULE_FIELDS.some((field) => next[field] !== current[field]);
    const becameAutomatic = input.mode === 'automatic' && current.mode !== 'automatic';
    const { today } =
      becameAutomatic || scheduleChanged
        ? await zoneAndToday(this.deps, scope.userId)
        : { today: undefined };
    const changes: RecurringPaymentChanges = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.amount === undefined ? {} : { amount: input.amount }),
      ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
      ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
      ...(input.mode === undefined ? {} : { mode: input.mode }),
      ...(input.reminderDays === undefined ? {} : { reminderDays: input.reminderDays }),
      ...(scheduleChanged ? next : {}),
      ...(today === undefined ? {} : { autoRecordingFrom: today }),
    };

    const updated = await this.deps.payments.update(scope, id, changes);
    if (scheduleChanged) await this.deps.occurrences.deletePendingFor(scope, id);
    return updated;
  }
}
