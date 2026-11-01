import type { DashboardFirstSteps, DashboardResponse } from '@pesly/shared';
import type { Clock, ReportPreferencesReader } from '../../reports';
import type { AccessScope } from '../../shared/access';
import type { Agenda } from '../domain/agenda';
import type { BudgetHighlight } from '../domain/budget-highlights';
import type { NetWorthParts } from '../domain/net-worth-now';
import {
  buildAvailable,
  type AvailableParts,
  type BuildAvailableDependencies,
} from './build-available';
import { buildAgenda, type AgendaDependencies } from './build-agenda';
import { buildBudgets, type BuildBudgetsDependencies } from './build-budgets';
import { buildFirstSteps, type FirstStepsDependencies } from './build-first-steps';
import { loadGroups, type GroupsDependencies, type GroupsSection } from './build-groups';
import {
  buildMonthFlows,
  type MonthFlowsDependencies,
  type MonthFlowsResult,
} from './build-month-flows';
import { buildNetWorth, type BuildNetWorthDependencies } from './build-net-worth';
import { prepareDashboard, type DashboardContext } from './dashboard-context';
import type { CardStatementSource } from './ports/card-statement-source';
import type { DashboardUseCase } from './ports/dashboard-use-case';

/** Everything the presenter needs, still in `bigint`. */
export interface DashboardSections {
  context: DashboardContext;
  netWorth: NetWorthParts;
  available: AvailableParts;
  month: MonthFlowsResult;
  budgets: BudgetHighlight[];
  agenda: Agenda;
  groups: GroupsSection;
  firstSteps: DashboardFirstSteps;
}

export interface GetDashboardDependencies {
  clock: Clock;
  preferences: ReportPreferencesReader;
  netWorth: BuildNetWorthDependencies;
  available: BuildAvailableDependencies;
  flows: MonthFlowsDependencies;
  budgets: BuildBudgetsDependencies;
  agenda: AgendaDependencies;
  /** Read once per request and shared by the agenda and the month (FEAT-015 NFR-01). */
  statements: CardStatementSource;
  groups: GroupsDependencies;
  firstSteps: FirstStepsDependencies;
  present: (sections: DashboardSections) => DashboardResponse;
}

/**
 * The dashboard of the caller (D12): preferences once, then the sections in parallel. There is no
 * `catch`: one rejected source rejects the request and no section is sent.
 */
export class GetDashboard implements DashboardUseCase {
  constructor(private readonly deps: GetDashboardDependencies) {}

  async execute(scope: AccessScope<'read'>): Promise<DashboardResponse> {
    const { deps } = this;
    const context = await prepareDashboard(deps, scope);
    // The group balances feed the net worth and the groups section: one read for both.
    const groups = loadGroups(deps.groups, scope);
    const owedStatements = deps.statements.owedStatements(
      scope,
      context.today,
      context.preferences.timeZone,
    );
    // Both consumers await it; a rejection is reported once, through `Promise.all` below.
    owedStatements.catch(() => undefined);
    const netWorthPromise = groups.then((section) =>
      buildNetWorth(deps.netWorth, scope, context, section.net),
    );
    const [netWorth, available, month, budgets, agenda, groupsSection, firstSteps] =
      await Promise.all([
        netWorthPromise,
        // The accounts read runs now; the rate is the one the net worth read, never a second query.
        buildAvailable(
          deps.available,
          scope,
          context,
          netWorthPromise.then((parts) => parts.rate),
        ),
        buildMonthFlows(deps.flows, scope, context, owedStatements),
        buildBudgets(deps.budgets, scope, context),
        buildAgenda(deps.agenda, scope, context, owedStatements),
        groups,
        buildFirstSteps(deps.firstSteps, scope),
      ]);
    return deps.present({
      context,
      netWorth,
      available,
      month,
      budgets,
      agenda,
      groups: groupsSection,
      firstSteps,
    });
  }
}
