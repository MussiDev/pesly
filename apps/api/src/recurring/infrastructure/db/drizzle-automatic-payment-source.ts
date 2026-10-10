import { and, asc, eq, gt } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import type {
  AutomaticPaymentEntry,
  AutomaticPaymentSource,
} from '../../application/ports/automatic-payment-source';
import { users } from './foreign-relations';
import { recurringPayments } from './schema';

/**
 * Cross-owner read for the system job (the one approved exception to owner scoping). It returns
 * identifiers, the schedule fields, the time zone and the language only, and is reachable only from the worker.
 * The owner and the time zone come from the same `users` row, so an erased user has no entry.
 */
export class DrizzleAutomaticPaymentSource implements AutomaticPaymentSource {
  constructor(private readonly db: Database) {}

  async page(afterId: string | null, limit: number): Promise<AutomaticPaymentEntry[]> {
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
          eq(recurringPayments.mode, 'automatic'),
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
