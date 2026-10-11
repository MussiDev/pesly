import type { BudgetCurrency } from '@pesly/shared';

/**
 * The values a budget holds from one month on. `effectiveFrom` is the first day of a month
 * (`YYYY-MM-01`); there is at most one version per budget and month. Money is in minor units.
 */
export interface BudgetVersion {
  effectiveFrom: string;
  name: string;
  amount: bigint;
  rollover: boolean;
  /** The selected categories only; subcategories are expanded on read. */
  categoryIds: string[];
  /** Ascending, 1 to 5 distinct percentages from 1 to 200. */
  thresholds: number[];
}

/** A budget as read: its identity plus the version in force and the categories it covers. */
export interface Budget {
  id: string;
  ownerId: string;
  /** Immutable after creation. */
  currency: BudgetCurrency;
  createdAt: Date;
  version: BudgetVersion;
  /** The selected categories plus the subcategories of every selected parent, deduplicated. */
  coveredCategoryIds: string[];
}

/** The fields an edit may change; an absent field keeps the current value. */
export interface BudgetChanges {
  name?: string;
  amount?: bigint;
  rollover?: boolean;
  categoryIds?: string[];
  thresholds?: number[];
}

/**
 * The version in force for a month: the one with the greatest `effectiveFrom` not after
 * `monthStart` (ISO dates compare as strings), or `null` when every version starts later.
 */
export function versionInForce(
  versions: readonly BudgetVersion[],
  monthStart: string,
): BudgetVersion | null {
  let best: BudgetVersion | null = null;
  for (const version of versions) {
    if (version.effectiveFrom > monthStart) continue;
    if (best === null || version.effectiveFrom > best.effectiveFrom) best = version;
  }
  return best;
}

/** The version an edit writes for `monthStart`: unspecified fields come from `current`. */
export function mergeVersion(
  current: BudgetVersion,
  changes: BudgetChanges,
  monthStart: string,
): BudgetVersion {
  return {
    effectiveFrom: monthStart,
    name: changes.name ?? current.name,
    amount: changes.amount ?? current.amount,
    rollover: changes.rollover ?? current.rollover,
    categoryIds: [...(changes.categoryIds ?? current.categoryIds)],
    thresholds: [...(changes.thresholds ?? current.thresholds)],
  };
}
