import type { AccessScope } from '../../../shared/access';
import type { FlowCurrency } from '../../domain/conversion';
import type { TopCategory } from '../../domain/flows';

/** Half-open `[from, before)` instants, the zone that buckets months, and the optional filters. */
export interface FlowWindow {
  from: Date;
  before: Date;
  timeZone: string;
  accountId?: string;
  tag?: string;
}

/** Sum of the expense or income movements of one (month, top category, currency, rate) group. */
export interface PersonalFlowRow {
  /** `YYYY-MM` in the window's zone. */
  month: string;
  type: 'expense' | 'income';
  topCategoryId: string;
  currency: FlowCurrency;
  /** The frozen rate, ARS per USD scaled by 10,000. */
  rate: bigint;
  sum: bigint;
  count: number;
}

/** Sum of the caller's shares of one (month, group category, currency, payer rate) group. */
export interface ShareFlowRow {
  month: string;
  categoryName: string | null;
  categoryDefaultKey: string | null;
  currency: FlowCurrency;
  /** The caller's own payer movement rate; null when someone else paid. */
  rate: bigint | null;
  sum: bigint;
  /** Shares, not rows of the grouping. */
  count: number;
}

/** Sum of the installments of one (period, statement, top category, currency) group. */
export interface InstallmentFlowRow {
  /** The statement's month, `YYYY-MM`. */
  period: string;
  /** The stored statement's due date, or null when the statement is not stored. */
  dueDate: string | null;
  closingDay: number;
  dueDay: number;
  topCategoryId: string;
  currency: FlowCurrency;
  /** Installments store no frozen rate. */
  rate: null;
  sum: bigint;
  count: number;
}

/**
 * Aggregated flows of the caller, one statement per method (never one per month or row). Amounts
 * are minor units of the row currency, unconverted; conversion is the domain's job. The use cases
 * call `shareRows` and `installmentRows` only when `accountId` and `tag` are both unset.
 */
export interface FlowReader {
  personalRows(scope: AccessScope, window: FlowWindow): Promise<PersonalFlowRow[]>;
  shareRows(scope: AccessScope, window: FlowWindow): Promise<ShareFlowRow[]>;
  /** Installments of the statements whose period is within `[periodFrom, periodTo]` (`YYYY-MM`). */
  installmentRows(
    scope: AccessScope,
    periodFrom: string,
    periodTo: string,
  ): Promise<InstallmentFlowRow[]>;
  /** The caller's top-level expense categories, oldest first. */
  topCategories(scope: AccessScope): Promise<TopCategory[]>;
}
