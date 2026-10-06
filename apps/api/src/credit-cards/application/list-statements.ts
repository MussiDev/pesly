import { firstOpenPeriod, statementDatesFor } from '@pesly/shared';
import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { StatementDraft, StatementView } from '../domain/credit-card';
import { missingStatements } from '../domain/statement-schedule';
import { todayOf, withStatus, type CreditCardDependencies } from './dependencies';

export class ListStatements {
  constructor(
    private readonly deps: Pick<CreditCardDependencies, 'cards' | 'timeZones' | 'clock'>,
  ) {}

  /**
   * The statements of the card, newest first. Missing cycles up to the one open today are created
   * first (user decision D6), which is why reading them takes a write scope.
   */
  async execute(scope: AccessScope<'write'>, cardId: string): Promise<StatementView[]> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, cardId));
    const today = await todayOf(this.deps, scope.userId);
    let statements = await this.deps.cards.listStatements(scope, cardId);
    const latest = statements.at(-1);
    let drafts: StatementDraft[];
    if (latest) {
      drafts = missingStatements(latest, card, today);
    } else {
      const period = firstOpenPeriod(today, card.closingDay);
      drafts = [{ period, ...statementDatesFor(period, card.closingDay, card.dueDay) }];
    }
    if (drafts.length > 0) {
      await this.deps.cards.insertStatements(scope, cardId, drafts);
      statements = await this.deps.cards.listStatements(scope, cardId);
    }
    return statements.map((statement) => withStatus(statement, today)).reverse();
  }
}
