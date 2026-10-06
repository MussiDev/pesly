import type { CreditCardResponse, StatementResponse } from '@pesly/shared';
import type { CreditCard, StatementView } from '../../domain/credit-card';

export function presentCreditCard(card: CreditCard): CreditCardResponse {
  return {
    id: card.id,
    name: card.name,
    closingDay: card.closingDay,
    dueDay: card.dueDay,
    arsAccountId: card.arsAccountId,
    usdAccountId: card.usdAccountId,
    createdAt: card.createdAt.toISOString(),
  };
}

export function presentStatement(statement: StatementView): StatementResponse {
  return {
    id: statement.id,
    cardId: statement.cardId,
    period: statement.period,
    closingDate: statement.closingDate,
    dueDate: statement.dueDate,
    status: statement.status,
  };
}
