import { and, asc, eq, gt } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import type {
  ReminderEntry,
  ReminderPaymentSource,
} from '../../application/ports/reminder-payment-source';
import { users } from './foreign-relations';
import { recurringPayments } from './schema';

/**
 * Cross-owner read for the reminder job (the approved exception to owner scoping, reachable only
 * from the worker). Active payments of every mode; the owner, time zone and language come from
 * the same `users` row, so an erased user has no entry.
 */
export class DrizzleReminderPaymentSource implements ReminderPaymentSource {
  constructor(private readonly db: Database) {}

  async page(afterId: string | null, limit: number): Promise<ReminderEntry[]> {
    const rows = await this.db
      .select({
        ownerId: users.id,
        timeZone: users.timeZone,
        language: users.language,
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
      })
      .from(recurringPayments)
      .innerJoin(users, eq(users.id, recurringPayments.ownerId))
      .where(
        and(
          eq(recurringPayments.status, 'active'),
          afterId === null ? undefined : gt(recurringPayments.id, afterId),
        ),
      )
      .orderBy(asc(recurringPayments.id))
      .limit(limit);
    return rows.map(({ ownerId, timeZone, language, ...payment }) => ({
      ownerId,
      timeZone,
      language,
      payment,
    }));
  }
}
