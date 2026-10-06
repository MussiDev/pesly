import type { AccessScope } from '../../shared/access';
import type { CreditCard } from '../domain/credit-card';
import type { CreditCardDependencies } from './dependencies';

export class ListCreditCards {
  constructor(private readonly deps: Pick<CreditCardDependencies, 'cards'>) {}

  execute(scope: AccessScope): Promise<CreditCard[]> {
    return this.deps.cards.list(scope);
  }
}
