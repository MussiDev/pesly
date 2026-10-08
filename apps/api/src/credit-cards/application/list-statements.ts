import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { StatementView } from '../domain/credit-card';
import { zoneAndToday, type CreditCardDependencies } from './dependencies';
import { ensureStatements } from './ensure-statements';
import { buildStatementViews } from './statement-views';

export class ListStatements {
  constructor(
    private readonly deps: Pick<
      CreditCardDependencies,
      'cards' | 'timeZones' | 'clock' | 'purchases' | 'installments' | 'cardPayments'
    >,
  ) {}

  /**
   * The statements of the card, newest first, with the totals of their purchases and installments
   * and the payments of the closed ones (FR-02, FR-03, FR-06). Missing cycles up to the one open
   * today are created first, which is why reading them takes a write scope.
   */
  async execute(scope: AccessScope<'write'>, cardId: string): Promise<StatementView[]> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, cardId));
    const { timeZone, today } = await zoneAndToday(this.deps, scope.userId);
    const statements = await ensureStatements(this.deps.cards, scope, card, today);
    const views = await buildStatementViews(this.deps, scope, card, statements, timeZone, today);
    return views.reverse();
  }
}
