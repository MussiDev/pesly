import { isStatementClosed, todayInTimeZone } from '@pesly/shared';
import type { Statement, StatementView } from '../domain/credit-card';
import type { AccountActivity } from './ports/account-activity';
import type { Clock } from './ports/clock';
import type { CreditCardRepository } from './ports/credit-card-repository';
import type { UserTimeZone } from './ports/user-time-zone';

export interface CreditCardDependencies {
  cards: CreditCardRepository;
  activity: AccountActivity;
  timeZones: UserTimeZone;
  clock: Clock;
}

/** The caller's calendar date, `YYYY-MM-DD`, in their stored time zone (PRD 01 FR-24). */
export async function todayOf(
  deps: Pick<CreditCardDependencies, 'timeZones' | 'clock'>,
  userId: string,
): Promise<string> {
  return todayInTimeZone(deps.clock.now(), await deps.timeZones.timeZoneOf(userId));
}

export function withStatus(statement: Statement, today: string): StatementView {
  return {
    ...statement,
    status: isStatementClosed(statement.closingDate, today) ? 'closed' : 'open',
  };
}
