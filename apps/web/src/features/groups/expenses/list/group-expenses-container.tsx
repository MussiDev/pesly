'use client';

import type {
  CategoryLanguage,
  ExpenseOptionsResponse,
  GroupCategoryResponse,
  GroupExpenseResponse,
} from '@pesly/shared';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { onSyncFinished } from '@/lib/sync/sync-events';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApiResult } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { formatDateTime, formatMoney } from '@/lib/format-amount';
import { resolveCategory } from '../../category-views/resolve-category';
import type { CategoryDisplay, FilteredTotal } from '../../category-views/types';
import { GroupNotFoundView } from '../../components/group-not-found';
import { canEditRecord, selfRole } from '../../edit/permissions';
import { applyQueuedValues } from '../../edit/queued-values';
import { useGroupChanges } from '../../edit/use-group-changes';
import { overlayGroupRecords } from '../../sync-overlay';
import { GroupsLoadStateView } from '../../components/groups-load-state';
import { isGroupId } from '../../group-id';
import {
  GroupExpensesList,
  type ExpenseListItem,
  type FilteredTotalItem,
} from './group-expenses-list';

const PAGE_SIZE = 50;

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'failed'; error: ErrorMessageKey }
  | { kind: 'not-found' }
  | {
      kind: 'ready';
      options: ExpenseOptionsResponse;
      role: string | null;
      expenses: GroupExpenseResponse[];
      nextCursor: string | null;
    };

export interface GroupExpensesContainerProps {
  groupId: string;
  /** Inclusive UTC bounds of the month shown; absent, the whole history (05f behavior). */
  range?: { from: string; to: string };
  categoryIds?: readonly string[];
  /** Per currency, from the summary of the same filter (D10). */
  filteredTotals?: readonly FilteredTotal[];
  onClearFilter?: () => void;
  /** Hands the group's categories to the page, which offers them as the filter (D8). */
  onLoadedOptions?: (categories: GroupCategoryResponse[]) => void;
  /**
   * Displays the page already knows (the summary names archived categories, which the options
   * omit); used for a row whose category the options do not list, so no extra request is made.
   */
  knownCategories?: ReadonlyMap<string, CategoryDisplay>;
  /** Rendered right after the page header and before the list (month picker, summary, filter). */
  controls?: ReactNode;
}

interface PageFilter {
  from?: string;
  to?: string;
  categoryIds?: string[];
}

/**
 * The expenses of one group, newest first. The first load makes three requests (NFR-02, D5): the first
 * page, the expense options, which name members and categories, and the group, which carries the
 * caller's role. The cursor only ever comes
 * from the previous response.
 */
export function GroupExpensesContainer(props: GroupExpensesContainerProps) {
  const { groupId } = props;
  if (!isGroupId(groupId)) return <GroupNotFoundView />;
  return <GroupExpensesScreen {...props} />;
}

function GroupExpensesScreen({
  groupId,
  range,
  categoryIds,
  filteredTotals,
  onClearFilter,
  onLoadedOptions,
  knownCategories,
  controls,
}: GroupExpensesContainerProps) {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('groups.expenses');
  const tErrors = useTranslations('errors');
  const locale = useLocale();
  const timeZone = useTimeZone() ?? 'UTC';
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Bumped when a sync pass finishes: the first page is read again without leaving the list.
  const [refresh, setRefresh] = useState(0);
  const changes = useGroupChanges(groupId);
  const tEdit = useTranslations('groups.edit.common');
  const [confirming, setConfirming] = useState<string>();
  const loadedKey = useRef('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<ErrorMessageKey>();
  // Bumped whenever the first page is requested again, so a late "load more" answer is dropped.
  const generation = useRef(0);
  // The group-level answers of the current load; a filter change reuses them (D4).
  const base = useRef<
    { key: string; options: ExpenseOptionsResponse; role: string | null } | undefined
  >(undefined);
  // The filter of the rows on screen, so "load more" continues the same list.
  const applied = useRef<PageFilter>({});
  const loadedFilter = useRef('');
  const [reloadError, setReloadError] = useState<ErrorMessageKey>();
  const onLoaded = useRef(onLoadedOptions);
  onLoaded.current = onLoadedOptions;

  const from = range?.from;
  const to = range?.to;
  const idsKey = categoryIds === undefined ? '' : categoryIds.join(',');
  const filterKey = `${from ?? ''}|${to ?? ''}|${idsKey}`;

  useEffect(
    () =>
      onSyncFinished(() => {
        setRefresh((current) => current + 1);
      }),
    [],
  );

  useEffect(() => {
    let active = true;
    generation.current += 1;
    const key = `${groupId}:${attempt}`;
    const baseKey = `${key}:${refresh}`;
    // A reload after a pass keeps what is on screen if it fails.
    const silent = loadedKey.current === key;
    const filter: PageFilter = {};
    if (from !== undefined) filter.from = from;
    if (to !== undefined) filter.to = to;
    if (idsKey !== '') filter.categoryIds = idsKey.split(',');
    const cached = base.current?.key === baseKey ? base.current : undefined;
    const pageRequest = api.listGroupExpenses(groupId, { limit: PAGE_SIZE, ...filter });
    void Promise.all([
      pageRequest,
      cached ? undefined : api.getExpenseOptions(groupId),
      cached ? undefined : api.getGroup(groupId),
    ]).then(([page, optionsResult, group]) => {
      if (!active) return;
      const failed = !page.ok
        ? page
        : optionsResult && !optionsResult.ok
          ? optionsResult
          : group && !group.ok
            ? group
            : undefined;
      if (failed === undefined && page.ok) {
        let loaded = cached;
        if (loaded === undefined && optionsResult?.ok && group?.ok) {
          loaded = {
            key: baseKey,
            options: optionsResult.data,
            role: selfRole(group.data.members, optionsResult.data.selfMemberId) ?? group.data.role,
          };
          base.current = loaded;
          onLoaded.current?.(optionsResult.data.categories);
        }
        if (loaded === undefined) return;
        loadedKey.current = key;
        loadedFilter.current = filterKey;
        applied.current = filter;
        setLoadingMore(false);
        setLoadMoreError(undefined);
        setReloadError(undefined);
        setState({
          kind: 'ready',
          options: loaded.options,
          role: loaded.role,
          expenses: page.data.items,
          nextCursor: page.data.nextCursor,
        });
      } else if (failed?.ok === false) {
        if (failed.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else if (failed.code === 'NOT_FOUND') setState({ kind: 'not-found' });
        else if (!silent) setState({ kind: 'failed', error: failed.messageKey });
        else if (loadedFilter.current !== filterKey) setReloadError(failed.messageKey);
      }
    });
    return () => {
      active = false;
    };
  }, [api, groupId, router, attempt, refresh, from, to, idsKey, filterKey]);

  if (state.kind === 'not-found') return <GroupNotFoundView />;

  if (state.kind !== 'ready') {
    const loadState = (
      <GroupsLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
    if (controls === undefined) return loadState;
    // The controls own their requests: they stay while the list loads or fails (AC-30).
    return (
      <div className="grid gap-6">
        <PageHeader
          title={t('title')}
          actions={
            <Link
              href={`/groups/${encodeURIComponent(groupId)}`}
              className={buttonVariants({ variant: 'outline' })}
            >
              {t('back')}
            </Link>
          }
        />
        {controls}
        {loadState}
      </div>
    );
  }

  const { options, role, expenses, nextCursor } = state;
  const memberName = (id: string): string =>
    options.members.find((member) => member.id === id)?.displayName ?? t('unnamedMember');

  const rowCategory = (id: string): CategoryDisplay => {
    const listed = resolveCategory(id, options.categories, language, t('uncategorized'));
    return listed.known ? listed : (knownCategories?.get(id) ?? listed);
  };

  const rows = overlayGroupRecords('expense', expenses, changes.changes);
  const items: ExpenseListItem[] = rows.map(({ record, syncState, failure, change }) => {
    const expense = applyQueuedValues(record, change);
    const own = expense.shares.find((share) => share.memberId === options.selfMemberId);
    const base = `/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expense.id)}`;
    return {
      id: expense.id,
      description: expense.description,
      category: rowCategory(expense.categoryId),
      payer: memberName(expense.payerMemberId),
      amount: formatMoney(BigInt(expense.amount), expense.currency, language),
      date: formatDateTime(expense.occurredAt, timeZone, language),
      share:
        own === undefined ? undefined : formatMoney(BigInt(own.amount), expense.currency, language),
      edit: changes.available
        ? {
            state: syncState,
            failureCode: failure?.code,
            allowed: canEditRecord(expense.createdByMemberId, options.selfMemberId, role),
            editHref: `${base}/edit`,
            confirmingDelete: confirming === expense.id,
            onDelete: () => {
              setConfirming(expense.id);
            },
            onCancelDelete: () => {
              setConfirming(undefined);
            },
            onConfirmDelete: () => {
              setConfirming(undefined);
              void changes.queueDelete({ kind: 'expense', base: record });
            },
            onRetry: () => void changes.retry('expense', expense.id),
            onDiscard: () => void changes.discard('expense', expense.id),
          }
        : undefined,
    };
  });

  const totals: FilteredTotalItem[] | undefined = filteredTotals?.map((entry) => ({
    currency: entry.currency,
    amount: formatMoney(entry.total, entry.currency, language),
    count: entry.count,
  }));

  function loadMore() {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(undefined);
    const started = generation.current;
    void api
      .listGroupExpenses(groupId, { limit: PAGE_SIZE, cursor: nextCursor, ...applied.current })
      .then((page: ApiResult<{ items: GroupExpenseResponse[]; nextCursor: string | null }>) => {
        if (started !== generation.current) return;
        setLoadingMore(false);
        if (page.ok) {
          setState((current) =>
            current.kind === 'ready'
              ? {
                  ...current,
                  expenses: [...current.expenses, ...page.data.items],
                  nextCursor: page.data.nextCursor,
                }
              : current,
          );
        } else if (page.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else setLoadMoreError(page.messageKey);
      });
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('title')}
        actions={
          <Link
            href={`/groups/${encodeURIComponent(groupId)}`}
            className={buttonVariants({ variant: 'outline' })}
          >
            {t('back')}
          </Link>
        }
      />
      {controls}
      {changes.ready && !changes.available ? (
        <p role="alert" className="text-small text-destructive">
          {tEdit('unavailable')}
        </p>
      ) : null}
      <GroupExpensesList
        groupId={groupId}
        items={items}
        hasMore={nextCursor !== null}
        loadingMore={loadingMore}
        loadMoreError={loadMoreError === undefined ? undefined : tErrors(loadMoreError)}
        onLoadMore={loadMore}
        filtered={idsKey !== ''}
        monthScoped={range !== undefined}
        filteredTotals={totals}
        onClearFilter={onClearFilter}
        reloadError={reloadError === undefined ? undefined : tErrors(reloadError)}
      />
    </div>
  );
}
