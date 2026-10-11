import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import type { CreditCard } from '../domain/credit-card';
import { recomputeOpenStatements } from '../domain/statement-schedule';
import { todayOf, type CreditCardDependencies } from './dependencies';
import type { CardSettings } from './ports/credit-card-repository';

export class UpdateCreditCardDays {
  constructor(
    private readonly deps: Pick<CreditCardDependencies, 'cards' | 'timeZones' | 'clock'>,
  ) {}

  /**
   * New default days apply to every open statement, overwriting hand-edited dates; closed ones
   * stay as they are (FR-06, user decision D5). A change that names neither day (only the
   * reminder lead time) leaves the statements untouched (10f D5). Missing or foreign:
   * `ResourceNotFound`.
   */
  async execute(
    scope: AccessScope<'write'>,
    id: string,
    change: Partial<CardSettings>,
  ): Promise<CreditCard> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, id));
    const settings: CardSettings = {
      closingDay: change.closingDay ?? card.closingDay,
      dueDay: change.dueDay ?? card.dueDay,
      reminderDays: change.reminderDays ?? card.reminderDays,
    };
    const changesDays = change.closingDay !== undefined || change.dueDay !== undefined;
    const recomputed = changesDays
      ? recomputeOpenStatements(
          await this.deps.cards.listStatements(scope, id),
          settings,
          await todayOf(this.deps, scope.userId),
        )
      : [];
    const updated = await this.deps.cards.updateDays(scope, id, settings, recomputed);
    if (!updated) throw new ResourceNotFound();
    return updated;
  }
}
