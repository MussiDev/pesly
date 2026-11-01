import {
  DASHBOARD_MAX_ACTIONS,
  DASHBOARD_MAX_UPCOMING,
  addDays,
  type AccountCurrency,
} from '@pesly/shared';

/** Entries and statements due within this many days after today are listed as upcoming. */
export const AGENDA_UPCOMING_DAYS = 7;
/** A closed statement owing money is an action once its due date is within this many days. */
export const AGENDA_STATEMENT_ACTION_DAYS = 3;

/** A recurring payment entry with the currency of its account. */
export interface AgendaRecurringEntry {
  kind: 'pending' | 'overdue' | 'scheduled';
  dueDate: string;
  paymentId: string;
  name: string;
  amount: bigint;
  currency: AccountCurrency;
  /** Set for pending and overdue entries. */
  occurrenceId: string | null;
}

/** A stored card statement and what is still owed on it per currency. */
export interface DueStatement {
  cardId: string;
  cardName: string;
  statementId: string;
  /** The statement's month, `YYYY-MM`. */
  period: string;
  dueDate: string;
  closed: boolean;
  owed: { ARS: bigint; USD: bigint };
}

export type AgendaUpcoming =
  | {
      kind: 'recurring_payment';
      paymentId: string;
      date: string;
      name: string;
      currency: AccountCurrency;
      amount: bigint;
    }
  | {
      kind: 'card_statement';
      cardId: string;
      statementId: string;
      date: string;
      name: string;
      currency: AccountCurrency;
      amount: bigint;
    };

export type AgendaAction =
  | { kind: 'overdue_occurrence'; dueDate: string; name: string; occurrenceId: string }
  | { kind: 'pending_occurrence'; dueDate: string; name: string; occurrenceId: string }
  | {
      kind: 'unpaid_statement';
      dueDate: string;
      name: string;
      statementId: string;
      cardId: string;
    };

export interface Agenda {
  upcoming: AgendaUpcoming[];
  actions: AgendaAction[];
}

const CURRENCIES = ['ARS', 'USD'] as const;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const upcomingId = (item: AgendaUpcoming): string =>
  item.kind === 'recurring_payment' ? item.paymentId : item.statementId;

const actionId = (item: AgendaAction): string =>
  item.kind === 'unpaid_statement' ? item.statementId : item.occurrenceId;

const overdueRank = (item: AgendaAction): number => (item.kind === 'overdue_occurrence' ? 0 : 1);

function owes(statement: DueStatement): boolean {
  return statement.owed.ARS > 0n || statement.owed.USD > 0n;
}

/**
 * Routes the entries exclusively (spec D9): an occurrence due before today, one due today and a
 * closed owing statement due by today + 3 are actions; every other owing statement due after today
 * and by today + 7, and every scheduled date in that span, is upcoming. An open statement due today
 * (or earlier) is in neither list.
 */
export function routeAgenda(input: {
  today: string;
  entries: readonly AgendaRecurringEntry[];
  statements: readonly DueStatement[];
}): Agenda {
  const { today } = input;
  const upcomingEnd = addDays(today, AGENDA_UPCOMING_DAYS);
  const actionEnd = addDays(today, AGENDA_STATEMENT_ACTION_DAYS);
  const upcoming: AgendaUpcoming[] = [];
  const actions: AgendaAction[] = [];

  for (const entry of input.entries) {
    if (entry.kind === 'scheduled') {
      if (entry.dueDate > today && entry.dueDate <= upcomingEnd) {
        upcoming.push({
          kind: 'recurring_payment',
          paymentId: entry.paymentId,
          date: entry.dueDate,
          name: entry.name,
          currency: entry.currency,
          amount: entry.amount,
        });
      }
      continue;
    }
    if (entry.occurrenceId === null) {
      throw new Error('A pending or overdue occurrence has no occurrence id');
    }
    actions.push({
      kind: entry.kind === 'overdue' ? 'overdue_occurrence' : 'pending_occurrence',
      dueDate: entry.dueDate,
      name: entry.name,
      occurrenceId: entry.occurrenceId,
    });
  }

  for (const statement of input.statements) {
    if (!owes(statement) || statement.dueDate > upcomingEnd) continue;
    if (statement.closed && statement.dueDate <= actionEnd) {
      actions.push({
        kind: 'unpaid_statement',
        dueDate: statement.dueDate,
        name: statement.cardName,
        statementId: statement.statementId,
        cardId: statement.cardId,
      });
    } else if (statement.dueDate > today) {
      for (const currency of CURRENCIES) {
        const amount = statement.owed[currency];
        if (amount <= 0n) continue;
        upcoming.push({
          kind: 'card_statement',
          cardId: statement.cardId,
          statementId: statement.statementId,
          date: statement.dueDate,
          name: statement.cardName,
          currency,
          amount,
        });
      }
    }
  }

  upcoming.sort(
    (a, b) =>
      compare(a.date, b.date) ||
      compare(a.kind, b.kind) ||
      compare(upcomingId(a), upcomingId(b)) ||
      compare(a.currency, b.currency),
  );
  actions.sort(
    (a, b) =>
      overdueRank(a) - overdueRank(b) ||
      compare(a.dueDate, b.dueDate) ||
      compare(a.kind, b.kind) ||
      compare(actionId(a), actionId(b)),
  );

  return {
    upcoming: upcoming.slice(0, DASHBOARD_MAX_UPCOMING),
    actions: actions.slice(0, DASHBOARD_MAX_ACTIONS),
  };
}
