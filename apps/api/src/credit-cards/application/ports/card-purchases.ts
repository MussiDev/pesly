import type { AccessScope } from '../../../shared/access';
import type { CreditCard } from '../../domain/credit-card';
import type { DailyPurchase } from '../../domain/statement-assignment';

/**
 * The purchases of a card, as sums per local day and currency; the movements module implements it
 * (spec D4, D7). Purchases are the expenses on the card's two linked accounts.
 */
export interface CardPurchases {
  dailyPurchases(scope: AccessScope, card: CreditCard, timeZone: string): Promise<DailyPurchase[]>;
}
