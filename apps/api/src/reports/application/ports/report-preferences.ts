import type { AccountCurrency, RateType } from '@pesly/shared';

export interface ReportPreferences {
  displayCurrency: AccountCurrency;
  defaultRateType: RateType;
  /** IANA zone; "today" and the month buckets of every report are computed in it. */
  timeZone: string;
}

export interface ReportPreferencesReader {
  /** The caller's own row by primary key. A missing user fails closed. */
  preferencesOf(userId: string): Promise<ReportPreferences>;
}
