import type { RecurringFrequencyValue, RecurringMode } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import { RecurringLimitReached } from '../domain/errors';
import { MAX_RECURRING_PAYMENTS, type RecurringPayment } from '../domain/recurring-payment';
import { zoneAndToday, type RecurringDependencies } from './dependencies';

export interface CreateRecurringPaymentInput {
  name: string;
  amount: bigint;
  accountId: string;
  categoryId: string;
  frequency: RecurringFrequencyValue;
  weekday?: number | undefined;
  dayOfMonth?: number | undefined;
  month?: number | undefined;
  startDate: string;
  endDate?: string | undefined;
  mode: RecurringMode;
}

export class CreateRecurringPayment {
  constructor(
    private readonly deps: Pick<RecurringDependencies, 'payments' | 'timeZones' | 'clock'>,
  ) {}

  /**
   * Ownership of the account and the expense category is enforced by the composite foreign keys,
   * so another user's ids fail the insert; archived ones are checked when an occurrence is recorded.
   */
  async execute(
    scope: AccessScope<'write'>,
    input: CreateRecurringPaymentInput,
  ): Promise<RecurringPayment> {
    if ((await this.deps.payments.count(scope)) >= MAX_RECURRING_PAYMENTS) {
      throw new RecurringLimitReached();
    }
    const { today } = await zoneAndToday(this.deps, scope.userId);
    return this.deps.payments.create(scope, {
      name: input.name,
      amount: input.amount,
      accountId: input.accountId,
      categoryId: input.categoryId,
      frequency: input.frequency,
      weekday: input.frequency === 'weekly' ? (input.weekday ?? null) : null,
      dayOfMonth: input.frequency === 'weekly' ? null : (input.dayOfMonth ?? null),
      month: input.frequency === 'yearly' ? (input.month ?? null) : null,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      mode: input.mode,
      scheduleFrom: input.startDate,
      autoRecordingFrom: today,
    });
  }
}
