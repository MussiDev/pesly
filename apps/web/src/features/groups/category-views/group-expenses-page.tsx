'use client';

import type { CategoryLanguage, GroupCategoryResponse } from '@pesly/shared';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { GroupExpensesContainer } from '../expenses/list/group-expenses-container';
import { GroupNotFoundView } from '../components/group-not-found';
import { isGroupId } from '../group-id';
import { ActiveFilterChips } from './components/active-filter-chips';
import { CategoryFilter } from './components/category-filter';
import { MonthPicker } from './components/month-picker';
import { currentMonth, monthBounds, offeredMonths } from './months';
import { resolveCategory } from './resolve-category';
import { CategorySummaryContainer } from './summary-container';
import { filteredTotals } from './summary-view';
import type { CategoryDisplay, SummaryView } from './types';

/**
 * The expenses page: a month picker, the spending summary, the category filter and the list. The
 * month and the filter are state here, not in the URL (D5), and reset when the group changes.
 */
export function GroupExpensesPage({ groupId }: { groupId: string }) {
  if (!isGroupId(groupId)) return <GroupNotFoundView />;
  return <GroupExpensesPageScreen key={groupId} groupId={groupId} />;
}

function GroupExpensesPageScreen({ groupId }: { groupId: string }) {
  const t = useTranslations('groups.categoryViews.page');
  const tExpenses = useTranslations('groups.expenses');
  const locale = useLocale();
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const timeZone = useTimeZone() ?? 'UTC';
  const [now] = useState(() => new Date());
  const months = useMemo(() => offeredMonths(now, timeZone), [now, timeZone]);
  const [month, setMonth] = useState(() => currentMonth(now, timeZone));
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<GroupCategoryResponse[]>([]);
  const [loaded, setLoaded] = useState<{ month: string; view: SummaryView }>();
  const range = useMemo(() => monthBounds(month, timeZone), [month, timeZone]);

  const onLoadedOptions = useCallback((next: GroupCategoryResponse[]) => {
    setCategories(next);
  }, []);
  const onLoadedSummary = useCallback(
    (view: SummaryView) => {
      setLoaded({ month, view });
    },
    [month],
  );

  // The summary of another month says nothing about this one (D8, D10).
  const view = loaded?.month === month ? loaded.view : undefined;

  const displays = new Map<string, CategoryDisplay>();
  for (const category of categories) {
    displays.set(
      category.id,
      resolveCategory(category.id, categories, language, tExpenses('uncategorized')),
    );
  }
  const options: CategoryDisplay[] = categories
    .filter((category) => category.archivedAt === null)
    .map((category) => displays.get(category.id))
    .filter((display): display is CategoryDisplay => display !== undefined);
  for (const entry of view?.currencies ?? []) {
    for (const line of entry.lines) {
      const { display } = line;
      // A merged "No category" line stands for several ids; one chip represents them all.
      if (!display.known) {
        const [first] = line.categoryIds;
        if (first !== undefined) displays.set(first, { ...display, id: first });
        continue;
      }
      if (!display.archived) continue;
      if (!options.some((option) => option.id === display.id)) options.push(display);
      displays.set(display.id, display);
    }
  }
  const offered = new Set(options.map((option) => option.id));
  const selected: CategoryDisplay[] = categoryIds.flatMap((id) => {
    const display = displays.get(id);
    return display === undefined ? [] : [display];
  });

  function changeMonth(next: string) {
    if (!months.includes(next)) return;
    setMonth(next);
    // An archived category is only offered for months that have a line for it, so it cannot
    // follow the filter into a month whose summary is not known yet.
    setCategoryIds((current) =>
      current.filter((id) => categories.some((c) => c.id === id && c.archivedAt === null)),
    );
  }

  function toggle(id: string) {
    if (!offered.has(id) && !categoryIds.includes(id)) return;
    setCategoryIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  return (
    <GroupExpensesContainer
      groupId={groupId}
      range={range}
      categoryIds={categoryIds}
      filteredTotals={view === undefined ? undefined : filteredTotals(view, categoryIds)}
      onClearFilter={() => {
        setCategoryIds([]);
      }}
      onLoadedOptions={onLoadedOptions}
      knownCategories={displays}
      controls={
        <section aria-label={t('filters')} className="grid gap-4">
          <MonthPicker months={months} value={month} onChange={changeMonth} />
          <CategorySummaryContainer
            groupId={groupId}
            range={range}
            selectedCategoryIds={categoryIds}
            onSelectCategory={setCategoryIds}
            onLoaded={onLoadedSummary}
          />
          <CategoryFilter options={options} selected={categoryIds} onToggle={toggle} />
          <ActiveFilterChips
            selected={selected}
            onRemove={toggle}
            onClear={() => {
              setCategoryIds([]);
            }}
          />
        </section>
      }
    />
  );
}
