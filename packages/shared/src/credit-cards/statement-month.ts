import { statementDatesFor } from './statement-cycle';

/** A statement row as the placement rule reads it. */
export interface InstallmentDueInput {
  period: string;
  /** The stored statement's due date, or null when the statement is not stored yet. */
  dueDate: string | null;
  closingDay: number;
  dueDay: number;
}

/** The stored due date, or the one derived from the card days. Throws on unusable days. */
export function installmentDueDate(row: InstallmentDueInput): string {
  return row.dueDate ?? statementDatesFor(row.period, row.closingDay, row.dueDay).dueDate;
}

/**
 * The `YYYY-MM` of the statement's due date: the month an installment or card purchase counts in.
 * When the days give no valid date it falls back to the period's month instead of failing, so the
 * purchase is counted in its own statement month.
 */
export function statementDueMonth(row: InstallmentDueInput): string {
  try {
    return installmentDueDate(row).slice(0, 7);
  } catch (error) {
    if (error instanceof RangeError) return row.period.slice(0, 7);
    throw error;
  }
}
