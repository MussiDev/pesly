import type { DueStatement } from './agenda';

const CURRENCIES = ['ARS', 'USD'] as const;

/** The key of one statement and currency: what a flow row is matched against. */
export function pendingKey(cardId: string, period: string, currency: 'ARS' | 'USD'): string {
  return `${cardId}|${period}|${currency}`;
}

/**
 * The statements that still owe money, per currency, with their due date (FEAT-015 FR-04): a
 * statement paid in one currency and owing the other is pending only in the one it owes.
 */
export function pendingKeys(statements: readonly DueStatement[]): Map<string, string> {
  const keys = new Map<string, string>();
  for (const statement of statements) {
    for (const currency of CURRENCIES) {
      if (statement.owed[currency] <= 0n) continue;
      keys.set(pendingKey(statement.cardId, statement.period, currency), statement.dueDate);
    }
  }
  return keys;
}
