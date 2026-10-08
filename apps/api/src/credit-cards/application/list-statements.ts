import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { StatementView } from '../domain/credit-card';
import { addInstallmentTotals, installmentsOfPeriod } from '../domain/installment';
import { statementTotals } from '../domain/statement-assignment';
import { withStatus, zoneAndToday, type CreditCardDependencies } from './dependencies';
import { ensureStatements } from './ensure-statements';

export class ListStatements {
  constructor(
    private readonly deps: Pick<
      CreditCardDependencies,
      'cards' | 'timeZones' | 'clock' | 'purchases' | 'installments'
    >,
  ) {}

  /**
   * The statements of the card, newest first, with the totals of their purchases and installments (FR-03, FR-06). Missing
   * cycles up to the one open today are created first, which is why reading them takes a write scope.
   */
  async execute(scope: AccessScope<'write'>, cardId: string): Promise<StatementView[]> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, cardId));
    const { timeZone, today } = await zoneAndToday(this.deps, scope.userId);
    const statements = await ensureStatements(this.deps.cards, scope, card, today);
    const daily = await this.deps.purchases.dailyPurchases(scope, card, timeZone);
    const rows = await this.deps.installments.listRows(scope, card.id);
    const totals = statementTotals(statements, daily);
    addInstallmentTotals(totals, statements, rows);
    return statements
      .map((statement) =>
        withStatus(
          statement,
          today,
          totals.get(statement.id),
          installmentsOfPeriod(rows, statement.period),
        ),
      )
      .reverse();
  }
}
