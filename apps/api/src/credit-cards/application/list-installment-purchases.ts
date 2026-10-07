import { notFoundUnlessAllowed, type AccessScope } from '../../shared/access';
import type { CreditCard, Statement } from '../domain/credit-card';
import {
  pendingDebt,
  viewPurchase,
  type InstallmentPurchaseView,
  type PendingDebt,
} from '../domain/installment';
import { todayOf, type CreditCardDependencies } from './dependencies';

export interface InstallmentPurchaseList {
  items: InstallmentPurchaseView[];
  pendingDebt: PendingDebt;
}

export type ReadDependencies = Pick<
  CreditCardDependencies,
  'cards' | 'timeZones' | 'clock' | 'installments'
>;

export async function cardContext(
  deps: ReadDependencies,
  scope: AccessScope,
  cardId: string,
): Promise<{ card: CreditCard; statements: Statement[]; today: string }> {
  const card = notFoundUnlessAllowed(await deps.cards.findById(scope, cardId));
  const [statements, today] = await Promise.all([
    deps.cards.listStatements(scope, card.id),
    todayOf(deps, scope.userId),
  ]);
  return { card, statements, today };
}

export class ListInstallmentPurchases {
  constructor(private readonly deps: ReadDependencies) {}

  /**
   * The card's active purchases with their installments and the card's pending debt, the
   * installments in statements not yet closed (FR-07). A read: statements that are not stored yet
   * get their default dates.
   */
  async execute(scope: AccessScope, cardId: string): Promise<InstallmentPurchaseList> {
    const { card, statements, today } = await cardContext(this.deps, scope, cardId);
    const purchases = await this.deps.installments.listPurchases(scope, card.id);
    const items = purchases.map((purchase) => viewPurchase(purchase, statements, card, today));
    return { items, pendingDebt: pendingDebt(items) };
  }
}
