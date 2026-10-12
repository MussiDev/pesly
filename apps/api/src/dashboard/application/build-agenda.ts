import type { UpcomingEntry } from '../../recurring';
import type { AccessScope } from '../../shared/access';
import { routeAgenda, type Agenda, type AgendaRecurringEntry } from '../domain/agenda';
import type { DashboardContext } from './dashboard-context';
import type { AccountCurrencyReader } from './ports/account-currency-reader';
import type { CardStatementSource } from './ports/card-statement-source';

/** The recurring source: a `ListUpcoming` built for the request, over its `ContextTimeZones`. */
export interface UpcomingSource {
  execute(scope: AccessScope): Promise<UpcomingEntry[]>;
}

export interface AgendaDependencies {
  upcoming: (context: DashboardContext) => UpcomingSource;
  currencies: AccountCurrencyReader;
  statements: CardStatementSource;
}

/** The upcoming and actions sections (FR-09, FR-10); both lists fail together with any source. */
export async function buildAgenda(
  deps: AgendaDependencies,
  scope: AccessScope,
  context: DashboardContext,
): Promise<Agenda> {
  const [recurring, statements] = await Promise.all([
    deps.upcoming(context).execute(scope),
    deps.statements.dueStatements(scope, context.today, context.preferences.timeZone),
  ]);
  const accountIds = [...new Set(recurring.map((entry) => entry.accountId))];
  const currencies = await deps.currencies.currenciesOf(scope, accountIds);

  const entries: AgendaRecurringEntry[] = recurring.map((entry) => {
    const currency = currencies.get(entry.accountId);
    if (currency === undefined) {
      throw new Error(`The account of recurring payment ${entry.paymentId} was not found`);
    }
    return {
      kind: entry.kind,
      dueDate: entry.dueDate,
      paymentId: entry.paymentId,
      name: entry.name,
      amount: entry.amount,
      currency,
      occurrenceId: entry.occurrenceId,
    };
  });

  return routeAgenda({ today: context.today, entries, statements });
}
