'use client';

import type { CategoryLanguage, ExpenseOptionsResponse, GroupExpenseResponse } from '@pesly/shared';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { Link, useRouter } from '@/i18n/navigation';
import type { ApiResult } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { formatDateTime, formatMoney } from '@/lib/format-amount';
import { groupCategoryLabel } from '../../components/group-categories-list';
import { GroupNotFoundView } from '../../components/group-not-found';
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
      expenses: GroupExpenseResponse[];
      nextCursor: string | null;
    };

export interface GroupExpensesContainerProps {
  groupId: string;
}

/**
 * The expenses of one group, newest first. The first load makes two requests (NFR-02): the first
 * page and the expense options, which name members and categories. The cursor only ever comes
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<ErrorMessageKey>();
  // Bumped whenever the first page is requested again, so a late "load more" answer is dropped.
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    generation.current += 1;
    void Promise.all([
      api.listGroupExpenses(groupId, { limit: PAGE_SIZE }),
      api.getExpenseOptions(groupId),
    ]).then(([page, options]) => {
      if (!active) return;
      const failed = !page.ok ? page : !options.ok ? options : undefined;
      if (failed === undefined && page.ok && options.ok) {
        setLoadingMore(false);
        setLoadMoreError(undefined);
        setState({
          kind: 'ready',
          options: options.data,
          expenses: page.data.items,
          nextCursor: page.data.nextCursor,
        });
      } else if (failed?.ok === false) {
        if (failed.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else if (failed.code === 'NOT_FOUND') setState({ kind: 'not-found' });
        else setState({ kind: 'failed', error: failed.messageKey });
      }
    });
    return () => {
      active = false;
    };
  }, [api, groupId, router, attempt]);

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

  const { options, expenses, nextCursor } = state;
  const memberName = (id: string): string =>
    options.members.find((member) => member.id === id)?.displayName ?? t('unnamedMember');
  const categoryName = (id: string): string => {
    const category = options.categories.find((item) => item.id === id);
    return category ? groupCategoryLabel(category, language) : t('uncategorized');
  };

  const items: ExpenseListItem[] = expenses.map((expense) => {
    const own = expense.shares.find((share) => share.memberId === options.selfMemberId);
    return {
      id: expense.id,
      description: expense.description,
      category: categoryName(expense.categoryId),
      payer: memberName(expense.payerMemberId),
      amount: formatMoney(BigInt(expense.amount), expense.currency, language),
      date: formatDateTime(expense.occurredAt, timeZone, language),
      share:
        own === undefined ? undefined : formatMoney(BigInt(own.amount), expense.currency, language),
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
