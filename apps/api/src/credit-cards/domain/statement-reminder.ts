import { addDays } from '@pesly/shared';
import type { Statement, StatementView } from './credit-card';
import { unpaidRemainder } from './automatic-debit';

/** The local time of day from which a reminder is due on its reminder day (PRD 10f FR-01). */
export const STATEMENT_REMINDER_TIME = '09:00';

/** The identity of a reminder inside one owner: the statement and the due date it was made for. */
export function reminderKey(statementId: string, dueDate: string): string {
  return `${statementId}|${dueDate}`;
}

/**
 * The statements to remind, oldest due date first: due today or later (a passed due date is never
 * reminded) and whose reminder day, `reminderDays` before the due date, has been reached (spec D6).
 */
export function reminderCandidates(input: {
  statements: readonly Statement[];
  reminderDays: number;
  today: string;
  reminderToday: string;
}): Statement[] {
  return input.statements
    .filter(
      (statement) =>
        statement.dueDate >= input.today &&
        addDays(statement.dueDate, -input.reminderDays) <= input.reminderToday,
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.period.localeCompare(b.period));
}

/**
 * True when something is left to pay in at least one currency. An open statement has no payments
 * allocated, so it owes its whole total (spec D7, D8).
 */
export function owesStatement(view: Pick<StatementView, 'totals' | 'payments'>): boolean {
  return (['ARS', 'USD'] as const).some(
    (currency) => unpaidRemainder(view.totals[currency], view.payments?.[currency].paid ?? 0n) > 0n,
  );
}
