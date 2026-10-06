import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import { CardHasMovements } from '../domain/errors';
import type { CreditCardDependencies } from './dependencies';

export class DeleteCreditCard {
  constructor(private readonly deps: Pick<CreditCardDependencies, 'cards' | 'activity'>) {}

  /**
   * Deletes the card, its statements and both linked accounts, only when neither account has
   * movements (user decision D1). Missing or foreign: `ResourceNotFound`.
   */
  async execute(scope: AccessScope<'write'>, id: string): Promise<void> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, id));
    const [ars, usd] = await Promise.all([
      this.deps.activity.hasMovements(card.arsAccountId),
      this.deps.activity.hasMovements(card.usdAccountId),
    ]);
    if (ars || usd) throw new CardHasMovements();
    if (!(await this.deps.cards.delete(scope, card))) throw new ResourceNotFound();
  }
}
