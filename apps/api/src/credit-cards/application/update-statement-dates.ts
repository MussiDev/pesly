import { isStatementClosed, nextPeriod, statementDatesFor } from '@pesly/shared';
import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import type { StatementView } from '../domain/credit-card';
import { StatementClosed } from '../domain/errors';
import { validateStatementDates } from '../domain/statement-schedule';
import { zoneAndToday, type CreditCardDependencies } from './dependencies';
import type { StatementDates } from './ports/credit-card-repository';
import { buildStatementViews } from './statement-views';

export class UpdateStatementDates {
  constructor(
    private readonly deps: Pick<
      CreditCardDependencies,
      'cards' | 'timeZones' | 'clock' | 'purchases' | 'installments' | 'cardPayments'
    >,
  ) {}

  /**
   * Moves the dates of a statement that is not closed yet (FR-05). A statement that is missing,
   * foreign or of another card: `ResourceNotFound`.
   */
  async execute(
    scope: AccessScope<'write'>,
    cardId: string,
    statementId: string,
    change: Partial<StatementDates>,
  ): Promise<StatementView> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, cardId));
    const statements = await this.deps.cards.listStatements(scope, cardId);
    const index = statements.findIndex((statement) => statement.id === statementId);
    const statement = notFoundUnlessAllowed(statements[index]);
    const { timeZone, today } = await zoneAndToday(this.deps, scope.userId);
    if (isStatementClosed(statement.closingDate, today)) throw new StatementClosed();

    const dates = {
      closingDate: change.closingDate ?? statement.closingDate,
      dueDate: change.dueDate ?? statement.dueDate,
    };
    // The next stored statement, when there is one, bounds the move as much as the next cycle.
    const nextCycle = statementDatesFor(nextPeriod(statement.period), card.closingDay, card.dueDay);
    const nextStored = statements[index + 1]?.closingDate;
    const nextClosing =
      nextStored !== undefined && nextStored < nextCycle.closingDate
        ? nextStored
        : nextCycle.closingDate;
    validateStatementDates(dates, statements[index - 1]?.closingDate ?? null, nextClosing);

    const updated = await this.deps.cards.updateStatement(scope, cardId, statementId, dates);
    if (!updated) throw new ResourceNotFound();
    const stored = statements.map((s) => (s.id === updated.id ? updated : s));
    const views = await buildStatementViews(this.deps, scope, card, stored, timeZone, today);
    return notFoundUnlessAllowed(views.find((view) => view.id === updated.id));
  }
}
