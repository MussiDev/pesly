'use client';

import type {
  AccountResponse,
  CategoryLanguage,
  CategoryResponse,
  MovementResponse,
} from '@pesly/shared';
import { useLocale } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { categoryLabel } from '@/features/categories/category-display';
import { useRouter } from '@/i18n/navigation';
import type { ApiResult } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { MovementList, type MovementListItem } from '../components/movement-list';
import {
  MovementsLoadStateView,
  type MovementsLoadState,
} from '../components/movements-load-state';

/** The API's largest page; also the size of each "show more" step. */
const PAGE_SIZE = 100;

interface ReadyState {
  kind: 'ready';
  movements: MovementResponse[];
  total: number;
  timeZone: string;
  accounts: Map<string, AccountResponse>;
  categories: Map<string, CategoryResponse>;
}

type ListState = MovementsLoadState | ReadyState;

/** Reads every page of a list, 100 at a time; an empty page ends the loop even on a stale total. */
async function loadAll<T>(
  fetchPage: (offset: number) => Promise<ApiResult<{ items: T[]; total: number }>>,
): Promise<ApiResult<T[]>> {
  const items: T[] = [];
  for (;;) {
    const page = await fetchPage(items.length);
    if (!page.ok) return page;
    items.push(...page.data.items);
    if (page.data.items.length === 0 || items.length >= page.data.total) {
      return { ok: true, data: items };
    }
  }
}

function indexById<T extends { id: string }>(...lists: T[][]): Map<string, T> {
  return new Map(lists.flat().map((item) => [item.id, item]));
}

export function MovementsContainer() {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ErrorMessageKey | undefined>();
  // Bumped on every (re)load, so a "show more" answer from before it is discarded.
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    setLoadingMore(false);
    setMoreError(undefined);
    let active = true;
    // A function, not the variable: TypeScript would narrow `active` to `true` across the awaits.
    const isActive = () => active;
    void (async () => {
      const [
        profile,
        first,
        activeAccounts,
        archivedAccounts,
        activeCategories,
        archivedCategories,
      ] = await Promise.all([
        api.getProfile(),
        api.listMovements({ limit: PAGE_SIZE }),
        loadAll((offset) =>
          api.listAccounts({
            archived: false,
            limit: PAGE_SIZE,
            ...(offset > 0 ? { offset } : {}),
          }),
        ),
        loadAll((offset) =>
          api.listAccounts({
            archived: true,
            limit: PAGE_SIZE,
            ...(offset > 0 ? { offset } : {}),
          }),
        ),
        loadAll((offset) =>
          api.listCategories({
            archived: false,
            limit: PAGE_SIZE,
            ...(offset > 0 ? { offset } : {}),
          }),
        ),
        loadAll((offset) =>
          api.listCategories({
            archived: true,
            limit: PAGE_SIZE,
            ...(offset > 0 ? { offset } : {}),
          }),
        ),
      ]);
      if (!isActive()) return;
      const results = [
        profile,
        first,
        activeAccounts,
        archivedAccounts,
        activeCategories,
        archivedCategories,
      ];
      for (const result of results) {
        if (!result.ok && result.code === 'UNAUTHENTICATED') {
          router.replace('/sign-in');
          return;
        }
      }
      for (const result of results) {
        if (!result.ok) {
          setState({ kind: 'failed', error: result.messageKey });
          return;
        }
      }
      if (
        !profile.ok ||
        !first.ok ||
        !activeAccounts.ok ||
        !archivedAccounts.ok ||
        !activeCategories.ok ||
        !archivedCategories.ok
      ) {
        return; // Unreachable: every failure returned above; this narrows the types.
      }
      setState({
        kind: 'ready',
        movements: first.data.items,
        total: first.data.total,
        timeZone: profile.data.preferences.timeZone,
        accounts: indexById(activeAccounts.data, archivedAccounts.data),
        categories: indexById(activeCategories.data, archivedCategories.data),
      });
    })();
    return () => {
      active = false;
    };
  }, [api, router, attempt]);

  async function showMore(current: ReadyState) {
    if (loadingMore) return;
    const requestGeneration = generation.current;
    setLoadingMore(true);
    setMoreError(undefined);
    const result = await api.listMovements({
      limit: PAGE_SIZE,
      offset: current.movements.length,
    });
    // A reload replaced the list while this page was in flight: its offset no longer applies.
    if (requestGeneration !== generation.current) return;
    setLoadingMore(false);
    if (result.ok) {
      const next = result.data;
      setState((latest) =>
        latest.kind === 'ready'
          ? {
              ...latest,
              // A movement created between pages shifts the offsets and repeats a boundary row.
              movements: [
                ...latest.movements,
                ...next.items.filter(
                  (item) => !latest.movements.some((shown) => shown.id === item.id),
                ),
              ],
              // An empty page on a stale total ends the paging instead of looping on it.
              total: next.items.length === 0 ? latest.movements.length : next.total,
            }
          : latest,
      );
    } else if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
    } else {
      setMoreError(result.messageKey);
    }
  }

  if (state.kind !== 'ready') {
    return (
      <MovementsLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((value) => value + 1);
        }}
      />
    );
  }

  const items: MovementListItem[] = state.movements.map((movement) => {
    const account = state.accounts.get(movement.accountId);
    const category = state.categories.get(movement.categoryId);
    return {
      movement,
      accountName: account?.name,
      currency: account?.currency,
      categoryName: category === undefined ? undefined : categoryLabel(category, language),
      categoryIcon: category?.icon,
      categoryColor: category?.color,
    };
  });

  return (
    <MovementList
      items={items}
      timeZone={state.timeZone}
      hasMore={state.movements.length < state.total}
      loadingMore={loadingMore}
      moreError={moreError}
      onShowMore={() => {
        void showMore(state);
      }}
    />
  );
}
