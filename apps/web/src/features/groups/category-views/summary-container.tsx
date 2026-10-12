'use client';

import type { CategoryLanguage } from '@pesly/shared';
import { ChartPie } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { GroupNotFoundView } from '../components/group-not-found';
import { GroupsLoadStateView } from '../components/groups-load-state';
import { isGroupId } from '../group-id';
import { CategorySummary } from './components/category-summary';
import { buildSummaryView } from './summary-view';
import type { SummaryView } from './types';

type SummaryState =
  | { kind: 'loading' }
  | { kind: 'failed'; error: ErrorMessageKey }
  | { kind: 'not-found' }
  | { kind: 'ready'; view: SummaryView; key: string };

export interface CategorySummaryContainerProps {
  groupId: string;
  /** Inclusive UTC bounds of the month shown. */
  range: { from: string; to: string };
  selectedCategoryIds: readonly string[];
  onSelectCategory: (categoryIds: string[]) => void;
  /** Called with each view that loads, so the page can offer archived categories and filtered totals. */
  onLoaded?: (view: SummaryView) => void;
}

/**
 * The "spending by category" section: one request per group and month (D4). It never blocks the
 * list: a failure stays inside this section with its own retry (AC-30).
 */
export function CategorySummaryContainer(props: CategorySummaryContainerProps) {
  if (!isGroupId(props.groupId)) return <GroupNotFoundView />;
  return <CategorySummaryScreen {...props} />;
}

function CategorySummaryScreen({
  groupId,
  range,
  selectedCategoryIds,
  onSelectCategory,
  onLoaded,
}: CategorySummaryContainerProps) {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('groups.categoryViews.summarySection');
  const tExpenses = useTranslations('groups.expenses');
  const locale = useLocale();
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const uncategorized = tExpenses('uncategorized');
  const [state, setState] = useState<SummaryState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // The latest callback without making it a dependency: a new function each render must not refetch.
  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  const { from, to } = range;
  const requestKey = `${groupId}|${from}|${to}`;

  useEffect(() => {
    // A newer range or group makes this answer stale: it is dropped.
    let active = true;
    void api.getGroupExpenseSummary(groupId, { from, to }).then((result) => {
      if (!active) return;
      if (result.ok) {
        const view = buildSummaryView(result.data, language, uncategorized);
        setState({ kind: 'ready', view, key: requestKey });
        loaded.current?.(view);
      } else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else if (result.code === 'NOT_FOUND') setState({ kind: 'not-found' });
      else setState({ kind: 'failed', error: result.messageKey });
    });
    return () => {
      active = false;
    };
  }, [api, groupId, from, to, attempt, language, uncategorized, router, requestKey]);

  if (state.kind === 'not-found') return <GroupNotFoundView />;

  // An answer for another month or group is not shown under this one's label.
  if (state.kind !== 'ready' || state.key !== requestKey) {
    return (
      <GroupsLoadStateView
        state={state.kind === 'failed' ? state : { kind: 'loading' }}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  const { view } = state;
  if (view.currencies.length === 0) {
    return (
      <EmptyState
        icon={<ChartPie aria-hidden="true" />}
        title={t('empty.title')}
        description={t('empty.description')}
      />
    );
  }

  const selected = new Set(selectedCategoryIds);
  const names = [
    ...new Set(
      view.currencies.flatMap((entry) =>
        entry.lines
          .filter((line) => line.categoryIds.some((id) => selected.has(id)))
          .map((line) => line.display.label),
      ),
    ),
  ];

  return (
    <section aria-labelledby="category-summary-title" className="grid gap-4">
      <h2 id="category-summary-title" className="text-heading">
        {t('title')}
      </h2>
      {names.length > 0 ? (
        <p className="text-small text-muted-foreground">
          {t('selected', { names: names.join(', ') })}
        </p>
      ) : null}
      <CategorySummary
        view={view}
        onSelect={onSelectCategory}
        selectedCategoryIds={selectedCategoryIds}
      />
    </section>
  );
}
