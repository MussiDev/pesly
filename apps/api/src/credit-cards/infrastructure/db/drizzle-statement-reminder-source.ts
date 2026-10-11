import { asc, eq, gt } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import type {
  StatementReminderEntry,
  StatementReminderSource,
} from '../../application/ports/statement-reminder-source';
import type { DebitLink } from '../../domain/credit-card';
import { users } from './foreign-relations';
import { creditCards } from './schema';

const debitLink = (accountId: string | null, linkedOn: string | null): DebitLink | null =>
  accountId !== null && linkedOn !== null ? { accountId, linkedOn } : null;

/**
 * Cross-owner read for the system job (an approved exception to owner scoping). It returns
 * identifiers, the card fields, the time zone and the language only, and is reachable only from
 * the worker. The owner, the zone and the language come from the same `users` row, so an erased
 * user has no entry.
 */
export class DrizzleStatementReminderSource implements StatementReminderSource {
  constructor(private readonly db: Database) {}

  async page(afterId: string | null, limit: number): Promise<StatementReminderEntry[]> {
    const rows = await this.db
      .select({
        ownerId: users.id,
        timeZone: users.timeZone,
        language: users.language,
        id: creditCards.id,
        name: creditCards.name,
        closingDay: creditCards.closingDay,
        dueDay: creditCards.dueDay,
        arsAccountId: creditCards.arsAccountId,
        usdAccountId: creditCards.usdAccountId,
        debitArsAccountId: creditCards.debitArsAccountId,
        debitUsdAccountId: creditCards.debitUsdAccountId,
        debitArsLinkedOn: creditCards.debitArsLinkedOn,
        debitUsdLinkedOn: creditCards.debitUsdLinkedOn,
        reminderDays: creditCards.reminderDays,
        createdAt: creditCards.createdAt,
      })
      .from(creditCards)
      .innerJoin(users, eq(users.id, creditCards.ownerId))
      .where(afterId === null ? undefined : gt(creditCards.id, afterId))
      .orderBy(asc(creditCards.id))
      .limit(limit);
    return rows.map(
      ({
        ownerId,
        timeZone,
        language,
        debitArsAccountId,
        debitUsdAccountId,
        debitArsLinkedOn,
        debitUsdLinkedOn,
        ...card
      }) => ({
        ownerId,
        timeZone,
        language,
        card: {
          ...card,
          debitAccounts: {
            ARS: debitLink(debitArsAccountId, debitArsLinkedOn),
            USD: debitLink(debitUsdAccountId, debitUsdLinkedOn),
          },
        },
      }),
    );
  }
}
