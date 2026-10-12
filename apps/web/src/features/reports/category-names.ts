import { DEFAULT_CATEGORIES, defaultCategoryName } from '@pesly/shared';
import type { Locale } from '@/i18n/routing';

export interface CategoryNameLabels {
  /** A row that matches no personal category: the shares of group expenses. */
  groupShares: string;
  /** A category with neither a known default key nor a stored name. */
  unnamed: string;
}

interface CategoryNameSource {
  categoryId: string | null;
  name: string | null;
  defaultKey: string | null;
}

/**
 * A default category shows its catalog name in the user's language; any other shows the stored name.
 * A row without category id and without a name is the group shares.
 */
export function categoryRowLabel(
  row: CategoryNameSource,
  locale: Locale,
  labels: CategoryNameLabels,
): string {
  const { defaultKey } = row;
  if (defaultKey !== null && DEFAULT_CATEGORIES.some((entry) => entry.key === defaultKey)) {
    return defaultCategoryName(defaultKey, locale);
  }
  if (row.name !== null && row.name.trim() !== '') return row.name;
  return row.categoryId === null ? labels.groupShares : labels.unnamed;
}
