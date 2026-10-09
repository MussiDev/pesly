import { addDays, dueDatesBetween, instantToZonedLocal, zonedLocalToInstant } from '@pesly/shared';
import { ResourceNotFound, type AccessScope } from '../../shared/access';
import { OccurrenceNotPending } from '../domain/errors';
import { MATERIALIZE_LOOKBACK_DAYS, type RecurringPayment } from '../domain/recurring-payment';
import type { RecurringDependencies } from './dependencies';
import type {
  AutomaticPaymentEntry,
  AutomaticPaymentSource,
} from './ports/automatic-payment-source';

/** The local time of day from which an occurrence of its due date counts as due (FR-02). */
const DUE_TIME = '06:00';
const DEFAULT_PAGE_SIZE = 500;

/** A failure to record, with identifiers only: no amount, name or message (FR-08). */
export interface RecordFailure {
  paymentId: string;
  /** `null` when the failure hit the payment before any occurrence was reached. */
  occurrenceId: string | null;
  errorName: string;
}

/** A benign event worth an info line. */
export interface RecordInfo {
  event: 'occurrence-missing';
  paymentId: string;
  occurrenceId: string;
}

export interface RecordSummary {
  payments: number;
  recorded: number;
  skippedAlreadyResolved: number;
  skippedMissing: number;
  failed: number;
}

export interface RecordDueOccurrencesDeps extends Pick<
  RecurringDependencies,
  'occurrences' | 'clock' | 'expenses'
> {
  source: AutomaticPaymentSource;
  /** Issues the write scope of a payment owner; the caller (the job factory) owns that policy. */
  scopeFor: (ownerId: string) => Promise<AccessScope<'write'>>;
  report: (failure: RecordFailure) => void;
  info: (info: RecordInfo) => void;
  pageSize?: number;
}

export class RecordDueOccurrences {
  constructor(private readonly deps: RecordDueOccurrencesDeps) {}

  /**
   * One pass: for every active automatic payment, records the expense of each pending occurrence
   * that is due in the owner's zone and on or after `autoRecordingFrom`. The movement id is the
   * occurrence id, so a repeated, concurrent or interrupted pass links the stored movement instead
   * of recording again (FR-06). Everything runs sequentially; a failure leaves the occurrence
   * pending for the next pass and never stops the others (FR-08).
   */
  async execute(): Promise<RecordSummary> {
    const summary: RecordSummary = {
      payments: 0,
      recorded: 0,
      skippedAlreadyResolved: 0,
      skippedMissing: 0,
      failed: 0,
    };
    const limit = this.deps.pageSize ?? DEFAULT_PAGE_SIZE;
    let afterId: string | null = null;
    for (;;) {
      const page: AutomaticPaymentEntry[] = await this.deps.source.page(afterId, limit);
      for (const entry of page) {
        summary.payments++;
        await this.processPayment(entry, summary);
      }
      const last = page[page.length - 1];
      if (page.length < limit || !last) return summary;
      afterId = last.payment.id;
    }
  }

  private async processPayment(
    { ownerId, timeZone, payment }: AutomaticPaymentEntry,
    summary: RecordSummary,
  ): Promise<void> {
    try {
      // An unknown zone name falls back to the stored default inside the shared time helpers.
      const local = instantToZonedLocal(this.deps.clock.now(), timeZone);
      const today = local.slice(0, 10);
      const lastDue = local.slice(11) >= DUE_TIME ? today : addDays(today, -1);
      const floor = addDays(today, -MATERIALIZE_LOOKBACK_DAYS);
      const from = [payment.scheduleFrom, payment.startDate, floor].reduce((a, b) =>
        a > b ? a : b,
      );
      const scope = await this.deps.scopeFor(ownerId);
      await this.deps.occurrences.insertIgnore(
        dueDatesBetween(payment, from, lastDue).map((dueDate) => ({
          paymentId: payment.id,
          ownerId,
          dueDate,
        })),
      );
      const recordFrom = payment.autoRecordingFrom > from ? payment.autoRecordingFrom : from;
      const recordable = await this.deps.occurrences.listRecordable(
        scope,
        payment.id,
        recordFrom,
        lastDue,
      );
      for (const occurrence of recordable) {
        await this.recordOne(scope, timeZone, payment, occurrence.id, summary);
      }
    } catch (error) {
      summary.failed++;
      this.deps.report({
        paymentId: payment.id,
        occurrenceId: null,
        errorName: errorNameOf(error),
      });
    }
  }

  private async recordOne(
    scope: AccessScope<'write'>,
    timeZone: string,
    payment: RecurringPayment,
    occurrenceId: string,
    summary: RecordSummary,
  ): Promise<void> {
    // Tells a ResourceNotFound raised by the recorder (a foreign movement id: a failure) from the
    // one raised by the lock (the row was deleted meanwhile: benign).
    const state = { recorderFailed: false };
    try {
      await this.deps.occurrences.withLockedPending(scope, occurrenceId, async (occurrence) => {
        // Noon exists on every real day except one skipped calendar day (Samoa, 2011): UTC noon then.
        const occurredAt =
          zonedLocalToInstant(`${occurrence.dueDate}T12:00`, timeZone) ??
          new Date(`${occurrence.dueDate}T12:00:00.000Z`);
        try {
          const movement = await this.deps.expenses.recordOnce(scope, occurrence.id, {
            accountId: payment.accountId,
            categoryId: payment.categoryId,
            amount: payment.amount,
            occurredAt,
            note: payment.name,
            rate: { source: 'automatic' },
          });
          return {
            status: 'confirmed',
            confirmedAmount: payment.amount,
            movementId: movement.id,
          };
        } catch (error) {
          state.recorderFailed = true;
          throw error;
        }
      });
      summary.recorded++;
    } catch (error) {
      if (error instanceof OccurrenceNotPending) {
        summary.skippedAlreadyResolved++;
      } else if (error instanceof ResourceNotFound && !state.recorderFailed) {
        summary.skippedMissing++;
        this.deps.info({ event: 'occurrence-missing', paymentId: payment.id, occurrenceId });
      } else {
        summary.failed++;
        this.deps.report({ paymentId: payment.id, occurrenceId, errorName: errorNameOf(error) });
      }
    }
  }
}

const errorNameOf = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : typeof error;
