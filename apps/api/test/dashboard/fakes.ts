import type { DashboardResponse } from '@pesly/shared';
import type { Clock } from '../../src/reports';
import type {
  ReportPreferences,
  ReportPreferencesReader,
} from '../../src/reports/application/ports/report-preferences';

export class FixedClock implements Clock {
  constructor(public current = new Date('2026-10-06T16:00:00.000Z')) {}

  now(): Date {
    return this.current;
  }
}

export class FakePreferences implements ReportPreferencesReader {
  calls = 0;

  constructor(
    private readonly value: ReportPreferences = {
      displayCurrency: 'ARS',
      defaultRateType: 'mep',
      timeZone: 'America/Argentina/Buenos_Aires',
    },
  ) {}

  preferencesOf(): Promise<ReportPreferences> {
    this.calls += 1;
    return Promise.resolve(this.value);
  }
}

const ZERO = { ars: '0', usd: '0' };

export const EMPTY_DASHBOARD_RESPONSE: DashboardResponse = {
  currency: 'ARS',
  today: '2026-10-06',
  netWorth: {
    ars: '0',
    usd: '0',
    total: '0',
    reason: null,
    holdingsWithoutPrice: 0,
    parts: { accounts: ZERO, investments: ZERO, groups: ZERO, installmentDebt: ZERO },
  },
  available: { ars: '0', usd: '0', total: '0', reason: null },
  month: {
    from: '2026-10-01',
    to: '2026-10-06',
    expenses: '0',
    income: '0',
    net: '0',
    change: { expenses: null, income: null, net: null },
    unconvertedShareCount: 0,
    unconvertedInstallmentCount: 0,
  },
  categories: [],
  budgets: [],
  upcoming: [],
  actions: [],
  groups: { owedToYou: ZERO, youOwe: ZERO },
  insight: null,
  firstSteps: { hasAccount: false, hasMovement: false, show: true },
};
