import { describe, expect, it } from 'vitest';
import {
  routeAgenda,
  type AgendaRecurringEntry,
  type DueStatement,
} from '../../src/dashboard/domain/agenda';

const TODAY = '2026-10-06';

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
}

function entry(n: number, overrides: Partial<AgendaRecurringEntry> = {}): AgendaRecurringEntry {
  return {
    kind: 'scheduled',
    dueDate: '2026-10-09',
    paymentId: uuid(n),
    name: `Payment ${n}`,
    amount: 1000n,
    currency: 'ARS',
    occurrenceId: null,
    ...overrides,
  };
}

function statement(n: number, overrides: Partial<DueStatement> = {}): DueStatement {
  return {
    cardId: uuid(100 + n),
    cardName: `Card ${n}`,
    statementId: uuid(200 + n),
    period: '2026-09',
    dueDate: '2026-10-12',
    closed: true,
    owed: { ARS: 5000n, USD: 0n },
    ...overrides,
  };
}

describe('routeAgenda', () => {
  it('lists a payment in 3 days and a statement in 6 days in upcoming, the payment first (AC-30)', () => {
    const { upcoming } = routeAgenda({
      today: TODAY,
      entries: [entry(1, { dueDate: '2026-10-09' })],
      statements: [statement(1, { dueDate: '2026-10-12' })],
    });

    expect(upcoming.map((item) => item.kind)).toEqual(['recurring_payment', 'card_statement']);
    expect(upcoming[0]).toMatchObject({ paymentId: uuid(1), date: '2026-10-09', amount: 1000n });
    expect(upcoming[1]).toMatchObject({
      cardId: uuid(101),
      statementId: uuid(201),
      date: '2026-10-12',
      currency: 'ARS',
      amount: 5000n,
      name: 'Card 1',
    });
  });

  it('leaves out an entry due in 8 days and a statement that owes nothing (AC-31)', () => {
    const { upcoming, actions } = routeAgenda({
      today: TODAY,
      entries: [entry(1, { dueDate: '2026-10-14' })],
      statements: [
        statement(1, { dueDate: '2026-10-14' }),
        statement(2, { dueDate: '2026-10-10', owed: { ARS: 0n, USD: 0n } }),
      ],
    });

    expect(upcoming).toEqual([]);
    expect(actions).toEqual([]);
  });

  it('keeps the 20 earliest of 25 entries in the next 7 days (AC-32)', () => {
    const entries = Array.from({ length: 25 }, (_, index) =>
      entry(index + 1, { dueDate: `2026-10-${String(7 + (index % 7)).padStart(2, '0')}` }),
    );

    const { upcoming } = routeAgenda({ today: TODAY, entries, statements: [] });

    expect(upcoming).toHaveLength(20);
    const dates = upcoming.map((item) => item.date);
    expect(dates).toEqual([...dates].sort());
    const keptIds = new Set(
      upcoming.map((item) => item.kind === 'recurring_payment' && item.paymentId),
    );
    const dropped = entries.filter((candidate) => !keptIds.has(candidate.paymentId));
    expect(dropped).toHaveLength(5);
    const lastKept = dates[dates.length - 1] ?? '';
    expect(dropped.every((item) => item.dueDate >= lastKept)).toBe(true);
  });

  it('puts overdue, pending and an unpaid statement due in 2 days in actions, overdue first (AC-33)', () => {
    const { actions, upcoming } = routeAgenda({
      today: TODAY,
      entries: [
        entry(1, { kind: 'pending', dueDate: TODAY, occurrenceId: uuid(901) }),
        entry(2, { kind: 'overdue', dueDate: '2026-10-04', occurrenceId: uuid(902) }),
      ],
      statements: [statement(1, { dueDate: '2026-10-08' })],
    });

    expect(actions).toEqual([
      {
        kind: 'overdue_occurrence',
        dueDate: '2026-10-04',
        name: 'Payment 2',
        occurrenceId: uuid(902),
      },
      { kind: 'pending_occurrence', dueDate: TODAY, name: 'Payment 1', occurrenceId: uuid(901) },
      {
        kind: 'unpaid_statement',
        dueDate: '2026-10-08',
        name: 'Card 1',
        statementId: uuid(201),
        cardId: uuid(101),
      },
    ]);
    expect(upcoming).toEqual([]);
  });

  it('ranks every overdue occurrence before an earlier-dated overdue statement', () => {
    const { actions } = routeAgenda({
      today: TODAY,
      entries: [entry(1, { kind: 'overdue', dueDate: '2026-10-05', occurrenceId: uuid(901) })],
      statements: [statement(1, { dueDate: '2026-09-20' })],
    });

    expect(actions.map((item) => item.kind)).toEqual(['overdue_occurrence', 'unpaid_statement']);
  });

  it('gives empty lists with nothing to resolve (AC-34)', () => {
    expect(routeAgenda({ today: TODAY, entries: [], statements: [] })).toEqual({
      upcoming: [],
      actions: [],
    });
  });

  it('routes exclusively: partly paid closed is an action, a farther one is upcoming, an open one due today is nowhere (AC-35)', () => {
    const { upcoming, actions } = routeAgenda({
      today: TODAY,
      entries: [],
      statements: [
        statement(1, { dueDate: '2026-10-09', owed: { ARS: 1n, USD: 0n } }),
        statement(2, { dueDate: '2026-10-10', owed: { ARS: 2n, USD: 3n } }),
        statement(3, { dueDate: TODAY, closed: false }),
        statement(4, { dueDate: '2026-10-08', closed: false }),
      ],
    });

    expect(actions.map((item) => item.kind === 'unpaid_statement' && item.statementId)).toEqual([
      uuid(201),
    ]);
    // One entry per statement and currency owed; the open one due in 2 days is upcoming.
    expect(
      upcoming.map((item) => item.kind === 'card_statement' && [item.statementId, item.currency]),
    ).toEqual([
      [uuid(204), 'ARS'],
      [uuid(202), 'ARS'],
      [uuid(202), 'USD'],
    ]);
  });

  it('caps actions at 20, ordered by date', () => {
    const entries = Array.from({ length: 25 }, (_, index) =>
      entry(index + 1, {
        kind: 'overdue',
        dueDate: `2026-09-${String(1 + index).padStart(2, '0')}`,
        occurrenceId: uuid(900 + index),
      }),
    );

    const { actions } = routeAgenda({ today: TODAY, entries, statements: [] });

    expect(actions).toHaveLength(20);
    expect(actions[0]?.dueDate).toBe('2026-09-01');
    expect(actions[19]?.dueDate).toBe('2026-09-20');
  });
});
