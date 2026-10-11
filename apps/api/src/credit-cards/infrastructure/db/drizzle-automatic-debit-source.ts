import { and, asc, eq, gt, isNotNull, or } from 'drizzle-orm';
import type { Database } from '../../../shared/db/client';
import type {
  AutomaticDebitEntry,
  AutomaticDebitSource,
} from '../../application/ports/automatic-debit-source';
import type { DebitLink } from '../../domain/credit-card';
import { users } from './foreign-relations';
import { creditCards } from './schema';

const debitLink = (accountId: string | null, linkedOn: string | null): DebitLink | null =>
  accountId !== null && linkedOn !== null ? { accountId, linkedOn } : null;

/**
 * Cross-owner read for the system job (the one approved exception to owner scoping). It returns
 * identifiers, the card fields and the time zone only, and is reachable only from the worker.
 * The owner and the time zone come from the same `users` row, so an erased user has no entry.
 */
export class DrizzleAutomaticDebitSource implements AutomaticDebitSource {
  constructor(private readonly db: Database) {}

  async page(afterId: string | null, limit: number): Promise<AutomaticDebitEntry[]> {
    const rows = await this.db
      .select({
        ownerId: users.id,
        timeZone: users.timeZone,
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
        createdAt: creditCards.createdAt,
      })
      .from(creditCards)
      .innerJoin(users, eq(users.id, creditCards.ownerId))
      .where(
        and(
          or(isNotNull(creditCards.debitArsAccountId), isNotNull(creditCards.debitUsdAccountId)),
          afterId === null ? undefined : gt(creditCards.id, afterId),
        ),
      )
      .orderBy(asc(creditCards.id))
      .limit(limit);
    return rows.map(
      ({
        ownerId,
        timeZone,
        debitArsAccountId,
        debitUsdAccountId,
        debitArsLinkedOn,
        debitUsdLinkedOn,
        ...card
      }) => ({
        ownerId,
        timeZone,
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
