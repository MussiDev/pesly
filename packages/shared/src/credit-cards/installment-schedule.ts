import { splitInstallments } from '../money/split-installments';
import {
  firstOpenPeriod,
  isStatementClosed,
  nextPeriod,
  statementDatesFor,
} from './statement-cycle';
import { assignStatement } from './statement-assignment';

export interface PlannedInstallment {
  /** 1-based position inside the purchase. */
  number: number;
  /** The statement the installment belongs to, `YYYY-MM` (spec D1). */
  period: string;
  amount: bigint;
}

export interface ScheduleStatement {
  period: string;
  closingDate: string;
  dueDate: string;
}

export interface ScheduleCard {
  closingDay: number;
  dueDay: number;
}

export interface ScheduleRow {
  number: number;
  amount: bigint;
  period: string;
  closingDate: string;
  dueDate: string;
  closed: boolean;
}

export interface InstallmentSchedule {
  kind: 'expense' | 'installments';
  rows: ScheduleRow[];
  firstClosed: boolean;
  firstClosingDate: string;
}

/**
 * The installments of a purchase (FR-03, FR-04): equal parts with the leftover on the first one,
 * the first assigned to `firstPeriod` and each following one to the next period.
 */
export function planInstallments(
  total: bigint,
  count: number,
  firstPeriod: string,
): PlannedInstallment[] {
  let period = firstPeriod;
  return splitInstallments(total, count).map((amount, index) => {
    if (index > 0) period = nextPeriod(period);
    return { number: index + 1, period, amount };
  });
}

/** The stored statement's dates, or the cycle's default dates when it is not stored yet (spec D1). */
export function datesOfPeriod(
  period: string,
  statements: readonly ScheduleStatement[],
  card: ScheduleCard,
): { closingDate: string; dueDate: string } {
  const stored = statements.find((statement) => statement.period === period);
  return stored
    ? { closingDate: stored.closingDate, dueDate: stored.dueDate }
    : statementDatesFor(period, card.closingDay, card.dueDay);
}

export interface PreviewInstallmentScheduleInput {
  total: bigint;
  count: number;
  /** Calendar day of the purchase, `YYYY-MM-DD`. */
  purchasedOn: string;
  /** Today in the user's time zone, `YYYY-MM-DD`. */
  today: string;
  card: ScheduleCard;
  statements: readonly ScheduleStatement[];
}

/**
 * The schedule a purchase would get, with the same rules the API applies when it is saved: the
 * first installment goes to the statement the purchase day belongs to.
 */
export function previewInstallmentSchedule(
  input: PreviewInstallmentScheduleInput,
): InstallmentSchedule {
  const { total, count, purchasedOn, today, card } = input;
  // assignStatement needs closing-date order and callers may pass any order.
  const statements = [...input.statements].sort((a, b) =>
    a.closingDate < b.closingDate ? -1 : a.closingDate > b.closingDate ? 1 : 0,
  );
  const firstPeriod =
    assignStatement(purchasedOn, statements)?.period ??
    statements[statements.length - 1]?.period ??
    firstOpenPeriod(purchasedOn, card.closingDay);

  const planned: PlannedInstallment[] =
    count === 1
      ? [{ number: 1, period: firstPeriod, amount: total }]
      : planInstallments(total, count, firstPeriod);
  const rows: ScheduleRow[] = planned.map((installment) => {
    const dates = datesOfPeriod(installment.period, statements, card);
    return {
      number: installment.number,
      amount: installment.amount,
      period: installment.period,
      ...dates,
      closed: isStatementClosed(dates.closingDate, today),
    };
  });
  const first = rows[0];
  if (!first) throw new RangeError('A schedule has at least one row');
  return {
    kind: count === 1 ? 'expense' : 'installments',
    rows,
    firstClosed: first.closed,
    firstClosingDate: first.closingDate,
  };
}
