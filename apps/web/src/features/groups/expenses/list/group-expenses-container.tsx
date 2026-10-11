'use client';

import type { CategoryLanguage, ExpenseOptionsResponse, GroupExpenseResponse } from '@pesly/shared';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { onSyncFinished } from '@/lib/sync/sync-events';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApiResult } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { formatDateTime, formatMoney } from '@/lib/format-amount';
import { groupCategoryLabel } from '../../components/group-categories-list';
import { GroupNotFoundView } from '../../components/group-not-found';
import { canEditRecord, selfRole } from '../../edit/permissions';
import { applyQueuedValues } from '../../edit/queued-values';
import { useGroupChanges } from '../../edit/use-group-changes';
import { overlayGroupRecords } from '../../sync-overlay';
import { GroupsLoadStateView } from '../../components/groups-load-state';
import { isGroupId } from '../../group-id';
import { GroupExpensesList, type ExpenseListItem } from './group-expenses-list';

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
}

/**
 * The expenses of one group, newest first. The first load makes three requests (NFR-02, D5): the first
 * page, the expense options, which name members and categories, and the group, which carries the
 * caller's role. The cursor only ever comes
 * from the previous response.
 */
export function GroupExpensesContainer({ groupId }: GroupExpensesContainerProps) {
  if (!isGroupId(groupId)) return <GroupNotFoundView />;
  return <GroupExpensesScreen groupId={groupId} />;
}

function GroupExpensesScreen({ groupId }: GroupExpensesContainerProps) {
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
    // A reload after a pass keeps what is on screen if it fails.
    const silent = loadedKey.current === key;
    void Promise.all([
      api.listGroupExpenses(groupId, { limit: PAGE_SIZE }),
      api.getExpenseOptions(groupId),
      api.getGroup(groupId),
    ]).then(([page, options, group]) => {
      if (!active) return;
      const failed = !page.ok ? page : !options.ok ? options : !group.ok ? group : undefined;
      if (failed === undefined && page.ok && options.ok && group.ok) {
        loadedKey.current = key;
        setLoadingMore(false);
        setLoadMoreError(undefined);
        setState({
          kind: 'ready',
          options: options.data,
          role: selfRole(group.data.members, options.data.selfMemberId) ?? group.data.role,
          expenses: page.data.items,
          nextCursor: page.data.nextCursor,
        });
      } else if (failed?.ok === false && !silent) {
        if (failed.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else if (failed.code === 'NOT_FOUND') setState({ kind: 'not-found' });
        else setState({ kind: 'failed', error: failed.messageKey });
      }
    });
    return () => {
      active = false;
    };
  }, [api, groupId, router, attempt, refresh]);

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

  const { options, role, expenses, nextCursor } = state;
  const memberName = (id: string): string =>
    options.members.find((member) => member.id === id)?.displayName ?? t('unnamedMember');
  const categoryName = (id: string): string => {
    const category = options.categories.find((item) => item.id === id);
    return category ? groupCategoryLabel(category, language) : t('uncategorized');
  };

  const rows = overlayGroupRecords('expense', expenses, changes.changes);
  const items: ExpenseListItem[] = rows.map(({ record, syncState, failure, change }) => {
    const expense = applyQueuedValues(record, change);
    const own = expense.shares.find((share) => share.memberId === options.selfMemberId);
    const base = `/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expense.id)}`;
    return {
      id: expense.id,
      description: expense.description,
      category: categoryName(expense.categoryId),
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

  function loadMore() {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(undefined);
    const started = generation.current;
    void api
      .listGroupExpenses(groupId, { limit: PAGE_SIZE, cursor: nextCursor })
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
      />
    </div>
  );
}
