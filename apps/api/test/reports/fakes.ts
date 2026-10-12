import type {
  ExpensesByCategoryResponse,
  IncomeExpensesResponse,
  NetWorthResponse,
} from '@pesly/shared';
import type { Clock } from '../../src/reports/application/ports/clock';
import type { ReportFilterReader } from '../../src/reports/application/ports/report-filter-reader';
import type {
  ReportPreferences,
  ReportPreferencesReader,
} from '../../src/reports/application/ports/report-preferences';
import type { AccessScope } from '../../src/shared/access';

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

/** Owns exactly the listed account ids and tag names (tags compared case-insensitively). */
export class FakeFilterReader implements ReportFilterReader {
  constructor(
    private readonly accounts: readonly string[] = [],
    private readonly tags: readonly string[] = [],
  ) {}

  ownsAccount(_scope: AccessScope, id: string): Promise<boolean> {
    return Promise.resolve(this.accounts.includes(id));
  }

  ownsTag(_scope: AccessScope, name: string): Promise<boolean> {
    return Promise.resolve(this.tags.some((tag) => tag.toLowerCase() === name.toLowerCase()));
  }
}

export const EMPTY_CATEGORY_RESPONSE: ExpensesByCategoryResponse = {
  currency: 'ARS',
  from: '2026-10-01',
  to: '2026-10-06',
  total: '0',
  categories: [],
  unconvertedShareCount: 0,
  unconvertedInstallmentCount: 0,
};

export const EMPTY_FLOW_RESPONSE: IncomeExpensesResponse = {
  currency: 'ARS',
  from: '2026-10-01',
  to: '2026-10-06',
  months: [],
  unconvertedShareCount: 0,
  unconvertedInstallmentCount: 0,
};

export const EMPTY_NET_WORTH_RESPONSE: NetWorthResponse = {
  currency: 'ARS',
  from: '2026-10-01',
  to: '2026-10-06',
  points: [],
};
