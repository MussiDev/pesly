import { isStatementClosed, todayInTimeZone } from '@pesly/shared';
import type { Statement, StatementView } from '../domain/credit-card';
import type { StatementInstallmentView } from '../domain/installment';
import type { StatementTotals } from '../domain/statement-assignment';
import type { AccountActivity } from './ports/account-activity';
import type { CardPayments } from './ports/card-payments';
import type { CardPurchases } from './ports/card-purchases';
import type { Clock } from './ports/clock';
import type { CreditCardRepository } from './ports/credit-card-repository';
import type { ExpenseCategoryGuard } from './ports/expense-category-guard';
import type { ExpenseRecorder } from './ports/expense-recorder';
import type { InstallmentRepository } from './ports/installment-repository';
import type { InstallmentWriteLimit } from './ports/installment-write-limit';
import type { StatementPaymentRecorder } from './ports/statement-payment-recorder';
import type { UserTimeZone } from './ports/user-time-zone';

export interface CreditCardDependencies {
  cards: CreditCardRepository;
  activity: AccountActivity;
  timeZones: UserTimeZone;
  clock: Clock;
  purchases: CardPurchases;
  expenses: ExpenseRecorder;
  installments: InstallmentRepository;
  categories: ExpenseCategoryGuard;
  writeLimit: InstallmentWriteLimit;
  cardPayments: CardPayments;
  paymentRecorder: StatementPaymentRecorder;
}

/** The caller's calendar date, `YYYY-MM-DD`, in their stored time zone (PRD 01 FR-24). */
export async function todayOf(
  deps: Pick<CreditCardDependencies, 'timeZones' | 'clock'>,
  userId: string,
): Promise<string> {
  return (await zoneAndToday(deps, userId)).today;
}

/** The caller's stored time zone and their calendar date in it. */
export async function zoneAndToday(
  deps: Pick<CreditCardDependencies, 'timeZones' | 'clock'>,
  userId: string,
): Promise<{ timeZone: string; today: string }> {
  const timeZone = await deps.timeZones.timeZoneOf(userId);
  return { timeZone, today: todayInTimeZone(deps.clock.now(), timeZone) };
}

export function withStatus(
  statement: Statement,
  today: string,
  totals: StatementTotals = { ARS: 0n, USD: 0n },
  installments: StatementInstallmentView[] = [],
): StatementView {
  return {
    ...statement,
    totals,
    installments,
    payments: null,
    status: isStatementClosed(statement.closingDate, today) ? 'closed' : 'open',
  };
}
