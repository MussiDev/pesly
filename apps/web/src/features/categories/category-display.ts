import {
  DEFAULT_CATEGORIES,
  displayCategoryName,
  type CategoryLanguage,
  type CategoryResponse,
} from '@pesly/shared';

const DEFAULT_POSITION = new Map(DEFAULT_CATEGORIES.map((entry, index) => [entry.key, index]));

/**
 * The name to show. A default whose key this build does not know (a newer catalog) shows its key
 * instead of failing the whole list.
 */
export function categoryLabel(category: CategoryResponse, language: CategoryLanguage): string {
  if (category.name === null && !DEFAULT_POSITION.has(category.key ?? '')) {
    return category.key ?? '';
  }
  return displayCategoryName(category, language);
}

/**
 * Defaults first, by their position in the shared catalog (seeded defaults share one `createdAt`,
 * so the API order is arbitrary), then custom categories by creation time.
 */
export function compareCategories(a: CategoryResponse, b: CategoryResponse): number {
  const positionA = a.key === null ? undefined : DEFAULT_POSITION.get(a.key);
  const positionB = b.key === null ? undefined : DEFAULT_POSITION.get(b.key);
  if (positionA !== undefined && positionB !== undefined) return positionA - positionB;
  if (positionA !== undefined) return -1;
  if (positionB !== undefined) return 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * A group's categories in the same order as the personal ones: defaults by their catalog position,
 * then the group's own ones as the API sent them (the sort is stable).
 */
export function compareGroupCategories(
  a: { defaultKey: string | null },
  b: { defaultKey: string | null },
): number {
  const positionA = a.defaultKey === null ? undefined : DEFAULT_POSITION.get(a.defaultKey);
  const positionB = b.defaultKey === null ? undefined : DEFAULT_POSITION.get(b.defaultKey);
  if (positionA !== undefined && positionB !== undefined) return positionA - positionB;
  if (positionA !== undefined) return -1;
  if (positionB !== undefined) return 1;
  return 0;
}
