import {
  isStatementClosed,
  type InstallmentCurrency,
  nextPeriod,
  splitInstallments,
  statementDatesFor,
  type StatementStatus,
} from '@pesly/shared';
import type { CreditCard, Statement } from './credit-card';
import type { StatementTotals } from './statement-assignment';

export interface PlannedInstallment {
  /** 1-based position inside the purchase. */
  number: number;
  /** The statement the installment belongs to, `YYYY-MM` (spec D1). */
  period: string;
  amount: bigint;
}

export interface InstallmentPurchase {
  id: string;
  cardId: string;
  categoryId: string;
  totalAmount: bigint;
  /** The purchase currency; its installments are in the same one. */
  currency: InstallmentCurrency;
  installmentCount: number;
  /** Calendar day of the purchase in the user's time zone, `YYYY-MM-DD`. */
  purchasedOn: string;
  note: string | null;
  createdAt: Date;
  installments: PlannedInstallment[];
}

export interface InstallmentWithDates extends PlannedInstallment {
  closingDate: string;
  dueDate: string;
  status: StatementStatus;
}

export interface InstallmentPurchaseView extends Omit<InstallmentPurchase, 'installments'> {
  installments: InstallmentWithDates[];
}

/** One installment as stored, flattened with what the totals need from its purchase. */
export interface InstallmentRow {
  cardId: string;
  purchaseId: string;
  number: number;
  count: number;
  period: string;
  amount: bigint;
  currency: InstallmentCurrency;
  categoryId: string;
}

/** An installment listed inside the statement of its period (FR-06). */
export interface StatementInstallmentView {
  purchaseId: string;
  number: number;
  count: number;
  amount: bigint;
  currency: InstallmentCurrency;
  categoryId: string;
}

export interface PendingDebt {
  ARS: bigint;
  USD: bigint;
}

export interface MonthlyInstallmentExpense {
  month: string;
  categoryId: string;
  currency: InstallmentCurrency;
  amount: bigint;
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
  statements: readonly Statement[],
  card: Pick<CreditCard, 'closingDay' | 'dueDay'>,
): { closingDate: string; dueDate: string } {
  const stored = statements.find((statement) => statement.period === period);
  return stored
    ? { closingDate: stored.closingDate, dueDate: stored.dueDate }
    : statementDatesFor(period, card.closingDay, card.dueDay);
}

export function viewPurchase(
  purchase: InstallmentPurchase,
  statements: readonly Statement[],
  card: Pick<CreditCard, 'closingDay' | 'dueDay'>,
  today: string,
): InstallmentPurchaseView {
  return {
    ...purchase,
    installments: purchase.installments.map((installment) => {
      const dates = datesOfPeriod(installment.period, statements, card);
      return {
        ...installment,
        ...dates,
        status: isStatementClosed(dates.closingDate, today) ? 'closed' : 'open',
      };
    }),
  };
}

/** Installments in statements that are not closed, per currency (FR-07). */
export function pendingDebt(purchases: readonly InstallmentPurchaseView[]): PendingDebt {
  const debt: PendingDebt = { ARS: 0n, USD: 0n };
  for (const purchase of purchases) {
    for (const installment of purchase.installments) {
      if (installment.status === 'open') debt[purchase.currency] += installment.amount;
    }
  }
  return debt;
}

/** The numbers of the installments whose statement is not closed: what a deletion removes (FR-08). */
export function openInstallmentNumbers(purchase: InstallmentPurchaseView): number[] {
  return purchase.installments
    .filter((installment) => installment.status === 'open')
    .map((installment) => installment.number);
}

/** Adds the installments of each statement's period to the statement's total (FR-06). */
export function addInstallmentTotals(
  totals: Map<string, StatementTotals>,
  statements: readonly Statement[],
  rows: readonly InstallmentRow[],
): void {
  const byPeriod = new Map(statements.map((statement) => [statement.period, statement.id]));
  for (const row of rows) {
    const id = byPeriod.get(row.period);
    const total = id === undefined ? undefined : totals.get(id);
    if (total) total[row.currency] += row.amount;
  }
}

/** Installments by the due-date month of their statement and by category (FR-05). */
export function monthlyInstallmentExpenses(
  rows: readonly InstallmentRow[],
  cards: ReadonlyMap<string, { card: CreditCard; statements: readonly Statement[] }>,
  range: { from: string; to: string },
): MonthlyInstallmentExpense[] {
  const sums = new Map<string, MonthlyInstallmentExpense>();
  for (const row of rows) {
    const owner = cards.get(row.cardId);
    if (!owner) continue;
    const month = datesOfPeriod(row.period, owner.statements, owner.card).dueDate.slice(0, 7);
    if (month < range.from || month > range.to) continue;
    const key = `${month}|${row.categoryId}|${row.currency}`;
    const sum = sums.get(key) ?? {
      month,
      categoryId: row.categoryId,
      currency: row.currency,
      amount: 0n,
    };
    sum.amount += row.amount;
    sums.set(key, sum);
  }
  return [...sums.values()].sort(
    (a, b) =>
      a.month.localeCompare(b.month) ||
      a.categoryId.localeCompare(b.categoryId) ||
      a.currency.localeCompare(b.currency),
  );
}

/** The installments assigned to the statement of `period`, in purchase and number order. */
export function installmentsOfPeriod(
  rows: readonly InstallmentRow[],
  period: string,
): StatementInstallmentView[] {
  return rows
    .filter((row) => row.period === period)
    .map(({ purchaseId, number, count, amount, currency, categoryId }) => ({
      purchaseId,
      number,
      count,
      amount,
      currency,
      categoryId,
    }));
}
