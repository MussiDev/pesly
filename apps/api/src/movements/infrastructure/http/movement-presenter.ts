import {
  formatMinorUnitsString,
  type ListMovementsResponse,
  type MovementResponse,
} from '@pesly/shared';
import type { Movement } from '../../domain/movement';

/** The only place where `bigint` becomes a decimal string and an instant an ISO 8601 UTC string. */
export function presentMovement(movement: Movement): MovementResponse {
  const base = {
    id: movement.id,
    type: movement.type,
    accountId: movement.accountId,
    amount: formatMinorUnitsString(movement.amount),
    occurredAt: movement.occurredAt.toISOString(),
    note: movement.note,
    tags: movement.tags,
    createdAt: movement.createdAt.toISOString(),
  };
  switch (movement.type) {
    case 'expense':
    case 'income':
      return {
        ...base,
        categoryId: movement.categoryId,
        destinationAccountId: null,
        destinationAmount: null,
        // The rate is a scaled integer: its plain decimal digits are the wire form.
        rate: movement.rate.toString(),
        rateSource: movement.rateSource,
        rateType: movement.rateType,
      };
    case 'transfer':
      return {
        ...base,
        categoryId: null,
        destinationAccountId: movement.destinationAccountId,
        destinationAmount: formatMinorUnitsString(movement.destinationAmount),
        rate: null,
        rateSource: null,
        rateType: null,
      };
    case 'exchange':
      return {
        ...base,
        categoryId: null,
        destinationAccountId: movement.destinationAccountId,
        destinationAmount: formatMinorUnitsString(movement.destinationAmount),
        rate: movement.rate.toString(),
        rateSource: movement.rateSource,
        rateType: null,
      };
  }
}

export function presentMovementList(
  list: { items: Movement[]; total: number },
  page: { limit: number; offset: number },
): ListMovementsResponse {
  return {
    items: list.items.map(presentMovement),
    total: list.total,
    limit: page.limit,
    offset: page.offset,
  };
}
