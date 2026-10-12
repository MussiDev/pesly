export interface CategoryTotal {
  /** The top-level category id; null for the shares that match no personal category. */
  categoryId: string | null;
  amount: bigint;
}

export function addToCategory(
  totals: Map<string | null, bigint>,
  categoryId: string | null,
  amount: bigint,
): void {
  totals.set(categoryId, (totals.get(categoryId) ?? 0n) + amount);
}

function compare(a: CategoryTotal, b: CategoryTotal): number {
  if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;
  if (a.categoryId === b.categoryId) return 0;
  if (a.categoryId === null) return 1;
  if (b.categoryId === null) return -1;
  return a.categoryId < b.categoryId ? -1 : 1;
}

/** Amount descending, then id ascending with the null category last. */
export function orderCategoryTotals(totals: ReadonlyMap<string | null, bigint>): CategoryTotal[] {
  return [...totals].map(([categoryId, amount]) => ({ categoryId, amount })).sort(compare);
}
