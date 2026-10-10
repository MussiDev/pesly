import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { CreditCard } from '../domain/credit-card';
import type { CreditCardDependencies } from './dependencies';

export class GetCreditCard {
  constructor(private readonly deps: Pick<CreditCardDependencies, 'cards'>) {}

  /** Missing or foreign: `ResourceNotFound`. */
  async execute(scope: AccessScope, id: string): Promise<CreditCard> {
    return notFoundUnlessAllowed(await this.deps.cards.findById(scope, id));
  }
}
