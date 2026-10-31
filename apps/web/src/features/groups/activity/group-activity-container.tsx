'use client';

import type { ActivityEntry, GroupDetailResponse } from '@pesly/shared';
import { History } from 'lucide-react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import type { Locale } from '@/i18n/routing';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { formatDateTime } from '@/lib/format-amount';
import { GroupNotFoundView } from '../components/group-not-found';
import { groupCategoryLabel } from '../components/group-categories-list';
import { GroupsLoadStateView, type GroupsLoadState } from '../components/groups-load-state';
import { isGroupId } from '../group-id';
import type { ActivityEntryData } from './activity-entry';
import { ActivityList } from './activity-list';
import { buildActivityView, mergeActivityPages } from './activity-view';

const PAGE_SIZE = 50;

type ScreenState =
  | GroupsLoadState
  | { kind: 'not-found' }
  | {
      kind: 'ready';
      group: GroupDetailResponse;
      entries: ActivityEntry[];
      nextCursor: string | null;
      loadingMore: boolean;
      moreFailed: boolean;
    };

type Categories = ReadonlyArray<{ id: string; name: string }>;
const NO_CATEGORIES: Categories = [];

/**
 * The activity log of one group. The page makes two requests (NFR-02): the group, for the names,
 * and the first page. Category names need a third request, made once and only when a shown entry
 * has a category value (D6).
 */
export function GroupActivityContainer({ groupId }: { groupId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('groups.activity');
  const tDetail = useTranslations('groups.detail');
  const locale = useLocale();
  const language: Locale = locale === 'en' ? 'en' : 'es';
  const timeZone = useTimeZone() ?? 'UTC';
  const validId = isGroupId(groupId);
  const [state, setState] = useState<ScreenState>(
    validId ? { kind: 'loading' } : { kind: 'not-found' },
  );
  const [attempt, setAttempt] = useState(0);
  const [categories, setCategories] = useState<Categories>(NO_CATEGORIES);
  // One category request per page load; a failure is not retried on its own.
  const categoriesRequested = useRef(false);

  useEffect(() => {
    if (!validId) return;
    let active = true;
    categoriesRequested.current = false;
    setCategories(NO_CATEGORIES);
    void Promise.all([
      api.getGroup(groupId),
      api.listGroupActivity(groupId, { limit: PAGE_SIZE }),
    ]).then(([group, page]) => {
      if (!active) return;
      if (
        (!group.ok && group.code === 'UNAUTHENTICATED') ||
        (!page.ok && page.code === 'UNAUTHENTICATED')
      ) {
        router.replace('/sign-in');
      } else if (!group.ok) {
        setState(
          group.code === 'NOT_FOUND'
            ? { kind: 'not-found' }
            : { kind: 'failed', error: group.messageKey },
        );
      } else if (!page.ok) {
        setState(
          page.code === 'NOT_FOUND'
            ? { kind: 'not-found' }
            : { kind: 'failed', error: page.messageKey },
        );
      } else {
        setState({
          kind: 'ready',
          group: group.data,
          entries: mergeActivityPages([], page.data.items),
          nextCursor: page.data.nextCursor,
          loadingMore: false,
          moreFailed: false,
        });
      }
    });
    return () => {
      active = false;
    };
  }, [api, groupId, router, attempt, validId]);

  const unnamed = tDetail('unnamed');
  const neutralCategory = t('neutralCategory');
  const splitEqual = t('splitModes.equal');
  const splitPercentage = t('splitModes.percentage');
  const splitExact = t('splitModes.exact');
  const readyGroup = state.kind === 'ready' ? state.group : null;
  const readyEntries = state.kind === 'ready' ? state.entries : null;

  const view = useMemo(() => {
    if (readyGroup === null || readyEntries === null) return [];
    return buildActivityView(
      readyEntries,
      { members: readyGroup.members, formerMembers: readyGroup.formerMembers },
      categories,
      {
        language,
        timeZone,
        unnamed,
        neutralCategory,
        splitModeLabels: { equal: splitEqual, percentage: splitPercentage, exact: splitExact },
      },
    );
  }, [
    readyGroup,
    readyEntries,
    categories,
    language,
    timeZone,
    unnamed,
    neutralCategory,
    splitEqual,
    splitPercentage,
    splitExact,
  ]);

  const needsCategories = view.some((row) => row.details.some((d) => d.field === 'category'));

  useEffect(() => {
    if (!needsCategories || categoriesRequested.current) return;
    categoriesRequested.current = true;
    // No cleanup guard: the ref allows one request, so a strict-mode remount must keep its answer.
    void api.listGroupCategories(groupId).then((result) => {
      if (result.ok) {
        setCategories(
          result.data.map((c) => ({ id: c.id, name: groupCategoryLabel(c, language) })),
        );
      }
    });
  }, [api, groupId, needsCategories, language]);

  if (state.kind === 'not-found') return <GroupNotFoundView />;

  if (state.kind !== 'ready') {
    return (
      <GroupsLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  const { group, nextCursor, loadingMore, moreFailed } = state;
  const rows: ActivityEntryData[] = view.map((row) => ({
    ...row,
    date: formatDateTime(row.createdAt, timeZone, language),
  }));

  function loadMore() {
    // The cursor is the one the previous answer carried; it is never typed by the user.
    if (nextCursor === null || loadingMore) return;
    setState((current) =>
      current.kind === 'ready' ? { ...current, loadingMore: true, moreFailed: false } : current,
    );
    void api.listGroupActivity(groupId, { limit: PAGE_SIZE, cursor: nextCursor }).then((page) => {
      if (!page.ok && page.code === 'UNAUTHENTICATED') {
        router.replace('/sign-in');
        return;
      }
      setState((current) => {
        if (current.kind !== 'ready') return current;
        if (!page.ok) return { ...current, loadingMore: false, moreFailed: true };
        return {
          ...current,
          entries: mergeActivityPages(current.entries, page.data.items),
          nextCursor: page.data.nextCursor,
          loadingMore: false,
          moreFailed: false,
        };
      });
    });
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={t('title')} description={group.name} />
      {rows.length === 0 ? (
        <EmptyState
          icon={<History aria-hidden="true" />}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
        />
      ) : (
        <ActivityList
          entries={rows}
          hasMore={nextCursor !== null}
          loadingMore={loadingMore}
          moreFailed={moreFailed}
          onLoadMore={loadMore}
        />
      )}
    </div>
  );
}
