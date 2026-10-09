import { zonedLocalToInstant } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { RecurringOccurrence } from '../domain/recurring-payment';
import { zoneAndToday, type RecurringDependencies } from './dependencies';

export interface ConfirmOccurrenceInput {
  amount?: bigint | undefined;
  date?: string | undefined;
}

export class ConfirmOccurrence {
  constructor(
    private readonly deps: Pick<
      RecurringDependencies,
      'payments' | 'occurrences' | 'timeZones' | 'clock' | 'expenses'
    >,
  ) {}

  /**
   * Records the expense and marks the occurrence confirmed in one locked transaction: when the
   * recorder rejects (archived account, future date, rate limit...) the error propagates and the
   * occurrence stays pending (AC-07, AC-08). Amount defaults to the payment's current amount and
   * the date to the due date; the movement is placed at noon of that day in the user's zone.
   */
  async execute(
    scope: AccessScope<'write'>,
    id: string,
    input: ConfirmOccurrenceInput = {},
  ): Promise<RecurringOccurrence> {
    const { timeZone } = await zoneAndToday(this.deps, scope.userId);
    return this.deps.occurrences.withLockedPending(scope, id, async (occurrence) => {
      const payment = await this.deps.payments.get(scope, occurrence.paymentId);
      const amount = input.amount ?? payment.amount;
      const date = input.date ?? occurrence.dueDate;
      // Noon exists on every real day except one skipped calendar day (Samoa, 2011): UTC noon then.
      const occurredAt =
        zonedLocalToInstant(`${date}T12:00`, timeZone) ?? new Date(`${date}T12:00:00.000Z`);
      const movement = await this.deps.expenses.record(scope, {
        accountId: payment.accountId,
        categoryId: payment.categoryId,
        amount,
        occurredAt,
        note: payment.name,
        rate: { source: 'automatic' },
      });
      return { status: 'confirmed', confirmedAmount: amount, movementId: movement.id };
    });
  }
}
