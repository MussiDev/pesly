import { isStatementClosed, nextPeriod, statementDatesFor } from '@pesly/shared';
import type { Statement, StatementDraft } from './credit-card';
import { CardDaysConflict, StatementDatesInvalid } from './errors';

export interface CardDays {
  closingDay: number;
  dueDay: number;
}

/** A card read after a century stops here instead of looping (spec Block 3). */
export const MAX_GENERATED_CYCLES = 1200;

/**
 * The cycles after `latest` up to and including the first one still open today (user decision D6).
 * A cycle whose default closing date is not after the previous one (moved there by hand) is
 * skipped, so closing dates always increase.
 */
export function missingStatements(
  latest: StatementDraft,
  days: CardDays,
  today: string,
): StatementDraft[] {
  const drafts: StatementDraft[] = [];
  let period = latest.period;
  let lastClosing = latest.closingDate;
  while (isStatementClosed(lastClosing, today) && drafts.length < MAX_GENERATED_CYCLES) {
    period = nextPeriod(period);
    const dates = statementDatesFor(period, days.closingDay, days.dueDay);
    if (dates.closingDate <= lastClosing) continue;
    drafts.push({ period, ...dates });
    lastClosing = dates.closingDate;
  }
  return drafts;
}

/**
 * The open statements recomputed with new default days, hand edits included (user decision D5).
 * `statements` are the card's statements ordered by closing date; closed ones are never returned.
 */
export function recomputeOpenStatements(
  statements: readonly Statement[],
  days: CardDays,
  today: string,
): Statement[] {
  const updated: Statement[] = [];
  let previousClosing: string | null = null;
  for (const statement of statements) {
    if (isStatementClosed(statement.closingDate, today)) {
      previousClosing = statement.closingDate;
      continue;
    }
    const dates = statementDatesFor(statement.period, days.closingDay, days.dueDay);
    if (previousClosing !== null && dates.closingDate <= previousClosing) {
      throw new CardDaysConflict();
    }
    updated.push({ ...statement, ...dates });
    previousClosing = dates.closingDate;
  }
  return updated;
}

/**
 * Valid dates sit after the previous statement's closing date and before the closing date that
 * comes next, with the due date after the closing date (spec D9).
 */
export function validateStatementDates(
  dates: { closingDate: string; dueDate: string },
  previousClosing: string | null,
  nextClosing: string,
): void {
  if (previousClosing !== null && dates.closingDate <= previousClosing) {
    throw new StatementDatesInvalid(
      'body.closingDate',
      'the closing date must be after the previous statement closing date',
    );
  }
  if (dates.closingDate >= nextClosing) {
    throw new StatementDatesInvalid(
      'body.closingDate',
      'the closing date must be before the next statement closing date',
    );
  }
  if (dates.dueDate <= dates.closingDate) {
    throw new StatementDatesInvalid('body.dueDate', 'the due date must be after the closing date');
  }
}
