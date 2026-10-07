import { firstOpenPeriod, statementDatesFor } from '@pesly/shared';
import type { AccessScope } from '../../shared/access';
import type { CreditCard, Statement, StatementDraft } from '../domain/credit-card';
import { missingStatements } from '../domain/statement-schedule';
import type { CreditCardRepository } from './ports/credit-card-repository';

/**
 * The stored statements of the card ordered by closing date, after creating the missing cycles up
 * to the one open on `today` (user decision D6), which is why it takes a write scope.
 */
export async function ensureStatements(
  cards: CreditCardRepository,
  scope: AccessScope<'write'>,
  card: CreditCard,
  today: string,
): Promise<Statement[]> {
  let statements = await cards.listStatements(scope, card.id);
  const latest = statements.at(-1);
  let drafts: StatementDraft[];
  if (latest) {
    drafts = missingStatements(latest, card, today);
  } else {
    const period = firstOpenPeriod(today, card.closingDay);
    drafts = [{ period, ...statementDatesFor(period, card.closingDay, card.dueDay) }];
  }
  if (drafts.length > 0) {
    await cards.insertStatements(scope, card.id, drafts);
    statements = await cards.listStatements(scope, card.id);
  }
  return statements;
}
