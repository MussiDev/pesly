/** Where this device counts how often each category was used for a new movement, per user. */
const KEY_PREFIX = 'pesly.categoryUse.';

export type CategoryUse = Readonly<Record<string, number>>;

/** Blocked storage (private mode) or a malformed value only means no order is learned. */
export function readCategoryUse(userId: string | undefined): CategoryUse {
  if (userId === undefined) return {};
  try {
    const raw = window.localStorage.getItem(`${KEY_PREFIX}${userId}`);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0,
      ),
    );
  } catch {
    return {};
  }
}

export function recordCategoryUse(userId: string | undefined, categoryId: string): void {
  if (userId === undefined) return;
  const use = readCategoryUse(userId);
  try {
    window.localStorage.setItem(
      `${KEY_PREFIX}${userId}`,
      JSON.stringify({ ...use, [categoryId]: (use[categoryId] ?? 0) + 1 }),
    );
  } catch {
    // Not learning the order only costs a scroll next time.
  }
}

/**
 * The categories with the most used first (a parent counts its subcategories' use too); ties keep
 * the order they came in, so a new user sees the usual order.
 */
export function rankByUse<T extends { id: string; parentId: string | null }>(
  categories: readonly T[],
  use: CategoryUse,
): T[] {
  const score = new Map<string, number>();
  for (const category of categories) {
    const own = use[category.id] ?? 0;
    score.set(category.id, (score.get(category.id) ?? 0) + own);
    if (category.parentId !== null) {
      score.set(category.parentId, (score.get(category.parentId) ?? 0) + own);
    }
  }
  return categories
    .map((category, index) => ({ category, index }))
    .sort(
      (a, b) =>
        (score.get(b.category.id) ?? 0) - (score.get(a.category.id) ?? 0) || a.index - b.index,
    )
    .map(({ category }) => category);
}
