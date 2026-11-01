import { describe, expect, it } from 'vitest';
import type { DueStatement } from '../../src/dashboard/domain/agenda';
import { pendingKey, pendingKeys } from '../../src/dashboard/domain/pending-card';

const statement = (fields: Partial<DueStatement>): DueStatement => ({
  cardId: 'card-1',
  cardName: 'Visa',
  statementId: 'statement-1',
  period: '2026-10',
  dueDate: '2026-11-05',
  closed: true,
  owed: { ARS: 100n, USD: 0n },
  ...fields,
});

describe('pendingKeys', () => {
  it('keys each owed currency of a statement to its due date and skips the paid one', () => {
    const keys = pendingKeys([
      statement({}),
      statement({ cardId: 'card-2', owed: { ARS: 0n, USD: 5n }, dueDate: '2026-11-10' }),
    ]);

    expect([...keys]).toEqual([
      [pendingKey('card-1', '2026-10', 'ARS'), '2026-11-05'],
      [pendingKey('card-2', '2026-10', 'USD'), '2026-11-10'],
    ]);
  });

  it('returns no key for no statements', () => {
    expect(pendingKeys([]).size).toBe(0);
  });
});
