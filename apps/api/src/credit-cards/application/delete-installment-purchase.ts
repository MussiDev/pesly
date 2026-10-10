import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import { openInstallmentNumbers, viewPurchase } from '../domain/installment';
import { todayOf, type CreditCardDependencies } from './dependencies';

export class DeleteInstallmentPurchase {
  constructor(
    private readonly deps: Pick<
      CreditCardDependencies,
      'cards' | 'timeZones' | 'clock' | 'installments'
    >,
  ) {}

  /**
   * Removes the installments of statements not closed yet and keeps the ones in closed statements
   * (FR-08, spec D5). A missing, cancelled or foreign purchase is `ResourceNotFound` (FR-09).
   */
  async execute(scope: AccessScope<'write'>, cardId: string, purchaseId: string): Promise<void> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, cardId));
    const purchase = await this.deps.installments.findPurchase(scope, card.id, purchaseId);
    if (!purchase) throw new ResourceNotFound();
    const statements = await this.deps.cards.listStatements(scope, card.id);
    const view = viewPurchase(purchase, statements, card, await todayOf(this.deps, scope.userId));
    const removed = await this.deps.installments.removeInstallments(
      scope,
      card.id,
      purchaseId,
      openInstallmentNumbers(view),
    );
    if (!removed) throw new ResourceNotFound();
  }
}
