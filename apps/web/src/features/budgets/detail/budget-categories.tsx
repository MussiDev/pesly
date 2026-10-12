'use client';

import type { CategoryLanguage, CategoryResponse } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { categoryLabel, compareCategories } from '@/features/categories/category-display';

export interface CoveredCategoryGroup {
  id: string;
  label: string;
  /** The id is not in the category list (archived): there is no name to show. */
  unavailable?: boolean;
  /** Only the selected subcategories. */
  children: { id: string; label: string }[];
}

/**
 * The categories the user selected, with each subcategory under its parent. A parent that was not
 * selected itself still heads the subcategories that were; an id the list does not know (an
 * archived category) has no name to show and is listed last, flagged as unavailable.
 */
export function coveredCategoryGroups(
  items: ReadonlyArray<CategoryResponse>,
  selectedIds: ReadonlyArray<string>,
  language: CategoryLanguage,
): CoveredCategoryGroup[] {
  const selected = new Set(selectedIds);
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = [...items].sort(compareCategories);
  const position = new Map(ordered.map((item, index) => [item.id, index]));
  const groups = new Map<string, CoveredCategoryGroup>();

  for (const item of ordered) {
    if (!selected.has(item.id)) continue;
    const parent = item.parentId === null ? item : (byId.get(item.parentId) ?? item);
    let group = groups.get(parent.id);
    if (group === undefined) {
      group = { id: parent.id, label: categoryLabel(parent, language), children: [] };
      groups.set(parent.id, group);
    }
    if (item.parentId !== null) {
      group.children.push({ id: item.id, label: categoryLabel(item, language) });
    }
  }
  const named = [...groups.values()].sort(
    (a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0),
  );
  const unknown = [...new Set(selectedIds)]
    .filter((id) => !byId.has(id))
    .map((id): CoveredCategoryGroup => ({ id, label: '', unavailable: true, children: [] }));
  return [...named, ...unknown];
}

/** The covered categories by name; pure. */
export function BudgetCategories({ groups }: { groups: ReadonlyArray<CoveredCategoryGroup> }) {
  const t = useTranslations('budgets.detail');
  const tForm = useTranslations('budgets.form');
  return (
    <section className="grid gap-2">
      <h2 className="text-h3 font-semibold">{t('categories')}</h2>
      <ul aria-label={t('categories')} className="grid gap-2">
        {groups.map((group) => (
          <li key={group.id} className="rounded-xl border bg-card px-4 py-3 text-body">
            <span>{group.unavailable ? tForm('categoryUnavailable') : group.label}</span>
            {group.children.length === 0 ? null : (
              <ul className="mt-1 grid gap-1 ps-4 text-small text-muted-foreground">
                {group.children.map((child) => (
                  <li key={child.id}>{child.label}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
