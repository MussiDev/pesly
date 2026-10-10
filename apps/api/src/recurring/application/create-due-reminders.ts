import { addDays, dueDatesBetween, instantToZonedLocal } from '@pesly/shared';
import type { Clock } from './ports/clock';
import type { NoticePublisher, PublishNoticeInput } from './ports/notice-publisher';
import type { OccurrenceRepository } from './ports/occurrence-repository';
import type { ReminderEntry, ReminderPaymentSource } from './ports/reminder-payment-source';

/** The local time of day from which the reminder of a day counts as due. */
const REMINDER_TIME = '09:00';
/** The longest reminder window: the reminder days go from 0 to 30. */
const HORIZON_DAYS = 30;
const DEFAULT_PAGE_SIZE = 500;

/** A failure to create reminders, with identifiers and the error class only (no name, no amount). */
export interface ReminderFailure {
  /** `null` when the whole page failed (the lookup or the insert). */
  paymentId: string | null;
  /** The keyset position of the page the failure belongs to. */
  afterId: string | null;
  errorName: string;
}

export interface ReminderSummary {
  payments: number;
  /** Reminders created by this pass; duplicates that already existed do not count. */
  reminders: number;
  failed: number;
}

export interface CreateDueRemindersDeps {
  source: ReminderPaymentSource;
  occurrences: Pick<OccurrenceRepository, 'listResolvedDueDates'>;
  notices: NoticePublisher;
  clock: Clock;
  report: (failure: ReminderFailure) => void;
  pageSize?: number;
}

interface Candidate {
  entry: ReminderEntry;
  /** Due dates whose reminder is due, each with the whole days from today. */
  dueDates: { dueDate: string; daysUntilDue: number }[];
}

export class CreateDueReminders {
  constructor(private readonly deps: CreateDueRemindersDeps) {}

  /**
   * One pass: a reminder for each due date in the next 30 days whose reminder day has arrived in
   * the owner's zone (09:00 or later; a missed day is made up until the due date). Everything is
   * idempotent through the notices key, so repeated or concurrent passes cannot duplicate. A
   * failure of one payment or one page is reported and never stops the others; what failed is
   * retried on the next pass.
   */
  async execute(): Promise<ReminderSummary> {
    const summary: ReminderSummary = { payments: 0, reminders: 0, failed: 0 };
    const limit = this.deps.pageSize ?? DEFAULT_PAGE_SIZE;
    let afterId: string | null = null;
    for (;;) {
      const page: ReminderEntry[] = await this.deps.source.page(afterId, limit);
      await this.processPage(afterId, page, summary);
      const last = page[page.length - 1];
      if (page.length < limit || !last) return summary;
      afterId = last.payment.id;
    }
  }

  private async processPage(
    afterId: string | null,
    page: ReminderEntry[],
    summary: ReminderSummary,
  ): Promise<void> {
    const now = this.deps.clock.now();
    const candidates: Candidate[] = [];
    for (const entry of page) {
      summary.payments++;
      try {
        const dueDates = this.dueReminders(entry, now);
        if (dueDates.length > 0) candidates.push({ entry, dueDates });
      } catch (error) {
        summary.failed++;
        this.deps.report({ paymentId: entry.payment.id, afterId, errorName: errorNameOf(error) });
      }
    }
    if (candidates.length === 0) return;

    try {
      const earliest = candidates
        .flatMap((candidate) => candidate.dueDates.map((item) => item.dueDate))
        .reduce((a, b) => (a < b ? a : b));
      const latest = candidates
        .flatMap((candidate) => candidate.dueDates.map((item) => item.dueDate))
        .reduce((a, b) => (a > b ? a : b));
      const resolved = await this.deps.occurrences.listResolvedDueDates(
        candidates.map((candidate) => candidate.entry.payment.id),
        earliest,
        latest,
      );
      const resolvedKeys = new Set(resolved.map((item) => `${item.paymentId}|${item.dueDate}`));
      const inputs: PublishNoticeInput[] = candidates.flatMap(({ entry, dueDates }) =>
        dueDates
          .filter((item) => !resolvedKeys.has(`${entry.payment.id}|${item.dueDate}`))
          .map((item) => ({
            ownerId: entry.ownerId,
            kind: 'reminder' as const,
            paymentId: entry.payment.id,
            paymentName: entry.payment.name,
            dueDate: item.dueDate,
            language: entry.language,
            daysUntilDue: item.daysUntilDue,
          })),
      );
      if (inputs.length > 0) summary.reminders += await this.deps.notices.publishMany(inputs);
    } catch (error) {
      summary.failed++;
      this.deps.report({ paymentId: null, afterId, errorName: errorNameOf(error) });
    }
  }

  /** The due dates of one payment whose reminder day has arrived, before resolved ones are removed. */
  private dueReminders(
    { timeZone, payment }: ReminderEntry,
    now: Date,
  ): { dueDate: string; daysUntilDue: number }[] {
    // An unknown zone name falls back to the stored default inside the shared time helpers.
    const local = instantToZonedLocal(now, timeZone);
    const today = local.slice(0, 10);
    const reminderToday = local.slice(11) >= REMINDER_TIME ? today : addDays(today, -1);
    const from = [payment.scheduleFrom, payment.startDate, today].reduce((a, b) => (a > b ? a : b));
    const daysFromToday = new Map<string, number>();
    for (let offset = 0; offset <= HORIZON_DAYS; offset++) {
      daysFromToday.set(addDays(today, offset), offset);
    }
    return dueDatesBetween(payment, from, addDays(today, HORIZON_DAYS)).flatMap((dueDate) => {
      const reminderDay = addDays(dueDate, -payment.reminderDays);
      const daysUntilDue = daysFromToday.get(dueDate);
      const qualifies =
        daysUntilDue !== undefined &&
        reminderDay >= payment.autoRecordingFrom &&
        reminderDay <= reminderToday;
      return qualifies ? [{ dueDate, daysUntilDue }] : [];
    });
  }
}

const errorNameOf = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : typeof error;
