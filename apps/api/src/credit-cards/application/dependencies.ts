import { isStatementClosed, todayInTimeZone } from '@pesly/shared';
import type { Statement, StatementView } from '../domain/credit-card';
import type { StatementTotals } from '../domain/statement-assignment';
import type { AccountActivity } from './ports/account-activity';
import type { CardPurchases } from './ports/card-purchases';
import type { Clock } from './ports/clock';
import type { CreditCardRepository } from './ports/credit-card-repository';
import type { ExpenseRecorder } from './ports/expense-recorder';
import type { UserTimeZone } from './ports/user-time-zone';

export interface CreditCardDependencies {
  cards: CreditCardRepository;
  activity: AccountActivity;
  timeZones: UserTimeZone;
  clock: Clock;
  purchases: CardPurchases;
  expenses: ExpenseRecorder;
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
): StatementView {
  return {
    ...statement,
    totals,
    status: isStatementClosed(statement.closingDate, today) ? 'closed' : 'open',
  };
}
