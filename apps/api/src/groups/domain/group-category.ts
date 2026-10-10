import { defaultCategoryNames, type CategoryColor, type CategoryIcon } from '@pesly/shared';

export interface GroupCategory {
  id: string;
  groupId: string;
  defaultKey: string | null;
  /** Null while a default is untouched; the client then shows the translated default name. */
  name: string | null;
  icon: CategoryIcon;
  color: CategoryColor;
  archivedAt: Date | null;
  createdAt: Date;
}

function fold(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * Same rule as personal categories (spec D8), re-implemented because the `categories` barrel also
 * loads its routes: a custom name alone, else both languages of the default key.
 */
export function effectiveNames(category: GroupCategory): string[] {
  if (category.name !== null) return [category.name];
  if (category.defaultKey === null) return [];
  const names = defaultCategoryNames(category.defaultKey);
  return [names.es, names.en];
}

/** The category whose effective name equals `candidate` (NFC, case-insensitive), or null. */
export function findNameConflict(
  categories: readonly GroupCategory[],
  candidate: string,
  excludeId: string | null,
): GroupCategory | null {
  const wanted = fold(candidate);
  for (const category of categories) {
    if (category.id === excludeId) continue;
    if (effectiveNames(category).some((name) => fold(name) === wanted)) return category;
  }
  return null;
}
