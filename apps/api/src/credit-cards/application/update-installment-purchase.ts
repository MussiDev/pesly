import { notFoundUnlessAllowed, ResourceNotFound, type AccessScope } from '../../shared/access';
import { viewPurchase, type InstallmentPurchaseView } from '../domain/installment';
import { todayOf, type CreditCardDependencies } from './dependencies';

export interface InstallmentPurchaseEdit {
  categoryId?: string;
  /** `null` clears the note. */
  note?: string | null;
}

export class UpdateInstallmentPurchase {
  constructor(
    private readonly deps: Pick<
      CreditCardDependencies,
      'cards' | 'timeZones' | 'clock' | 'installments' | 'categories'
    >,
  ) {}

  /**
   * Changes the category and the note; amounts and counts are fixed (spec D4). A missing, cancelled
   * or foreign purchase is `ResourceNotFound` before anything changes (FR-09); a new category must
   * be an open expense category of the caller.
   */
  async execute(
    scope: AccessScope<'write'>,
    cardId: string,
    purchaseId: string,
    edit: InstallmentPurchaseEdit,
  ): Promise<InstallmentPurchaseView> {
    const card = notFoundUnlessAllowed(await this.deps.cards.findById(scope, cardId));
    const current = await this.deps.installments.findPurchase(scope, card.id, purchaseId);
    if (!current) throw new ResourceNotFound();
    if (edit.categoryId !== undefined && edit.categoryId !== current.categoryId) {
      await this.deps.categories.assertOpenExpenseCategory(scope, edit.categoryId);
    }
    const updated = await this.deps.installments.updatePurchase(scope, card.id, purchaseId, edit);
    if (!updated) throw new ResourceNotFound();
    const statements = await this.deps.cards.listStatements(scope, card.id);
    return viewPurchase(updated, statements, card, await todayOf(this.deps, scope.userId));
  }
}
