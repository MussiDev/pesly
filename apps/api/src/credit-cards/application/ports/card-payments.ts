import type { AccessScope } from '../../../shared/access';
import type { CreditCard } from '../../domain/credit-card';
import type { StatementTotals } from '../../domain/statement-assignment';

/**
 * What the card has received, in minor units per currency: the transfers whose destination is one
 * of its linked accounts (spec D2). The movements module implements it.
 */
export interface CardPayments {
  receivedByCard(scope: AccessScope, card: CreditCard): Promise<StatementTotals>;
}
