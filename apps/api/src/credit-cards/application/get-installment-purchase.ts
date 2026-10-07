import { ResourceNotFound, type AccessScope } from '../../shared/access';
import { viewPurchase, type InstallmentPurchaseView } from '../domain/installment';
import { cardContext, type ReadDependencies } from './list-installment-purchases';

export class GetInstallmentPurchase {
  constructor(private readonly deps: ReadDependencies) {}

  /** Missing, cancelled or foreign purchase: `ResourceNotFound` (FR-09). */
  async execute(
    scope: AccessScope,
    cardId: string,
    purchaseId: string,
  ): Promise<InstallmentPurchaseView> {
    const { card, statements, today } = await cardContext(this.deps, scope, cardId);
    const purchase = await this.deps.installments.findPurchase(scope, card.id, purchaseId);
    if (!purchase) throw new ResourceNotFound();
    return viewPurchase(purchase, statements, card, today);
  }
}
