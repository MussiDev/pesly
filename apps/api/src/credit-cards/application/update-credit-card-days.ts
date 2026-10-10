import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import type { CreditCard } from '../domain/credit-card';
import { recomputeOpenStatements } from '../domain/statement-schedule';
import { todayOf, type CreditCardDependencies } from './dependencies';
import type { CardDays } from './ports/credit-card-repository';

export class UpdateCreditCardDays {
  constructor(
    private readonly deps: Pick<CreditCardDependencies, 'cards' | 'timeZones' | 'clock'>,
  ) {}

  /**
   * New default days apply to every open statement, overwriting hand-edited dates; closed ones
   * stay as they are (FR-06, user decision D5). Missing or foreign: `ResourceNotFound`.
   */
  async execute(
    scope: AccessScope<'write'>,
    id: string,
    change: Partial<CardDays>,
  ): Promise<CreditCard> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, id));
    const days = {
      closingDay: change.closingDay ?? card.closingDay,
      dueDay: change.dueDay ?? card.dueDay,
    };
    const today = await todayOf(this.deps, scope.userId);
    const statements = await this.deps.cards.listStatements(scope, id);
    const recomputed = recomputeOpenStatements(statements, days, today);
    const updated = await this.deps.cards.updateDays(scope, id, days, recomputed);
    if (!updated) throw new ResourceNotFound();
    return updated;
  }
}
