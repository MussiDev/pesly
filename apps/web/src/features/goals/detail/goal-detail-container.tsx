'use client';

import {
  GOAL_ENTRIES_PAGE_SIZE_MAX,
  type GoalEntryResponse,
  type GoalResponse,
  type RecordGoalEntryResponse,
} from '@pesly/shared';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import {
  GroupsLoadStateView,
  type GroupsLoadState,
} from '@/features/groups/components/groups-load-state';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { canLoadMore, ENTRIES_FIRST_LIMIT, nextEntriesLimit } from '../helpers/entries-paging';
import { GoalDetailView } from './goal-detail-view';
import { GoalNotFound } from './goal-not-found';

type ScreenState =
  | GroupsLoadState
  | { kind: 'not-found' }
  | {
      kind: 'ready';
      goal: GoalResponse;
      /** Null for a linked goal. */
      entries: GoalEntryResponse[] | null;
      /** The limit of the last page request and how many entries it returned. */
      asked: number;
      returned: number;
      loadingMore: boolean;
      moreError: ErrorMessageKey | null;
    };

const goalIdSchema = z.uuid();

/** The response, plus entries recorded here while it was in flight; the newest stay on top. */
function mergeEntries(
  fetched: GoalEntryResponse[],
  local: GoalEntryResponse[],
): GoalEntryResponse[] {
  const known = new Set(fetched.map((entry) => entry.id));
  const extra = local.filter((entry) => !known.has(entry.id));
  return [...extra, ...fetched].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * One goal and its entries. 2 requests for an unlinked goal, 1 for a linked one (D5); recording
 * an entry updates the screen from the response without asking again (FR-10).
 */
export function GoalDetailContainer({ goalId }: { goalId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const validId = goalIdSchema.safeParse(goalId).success;
  const [state, setState] = useState<ScreenState>(
    validId ? { kind: 'loading' } : { kind: 'not-found' },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!validId) return;
    const run = { active: true };
    const stale = () => !run.active;
    void (async () => {
      const goal = await api.getGoal(goalId);
      if (stale()) return;
      if (!goal.ok) {
        if (goal.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else if (goal.code === 'NOT_FOUND') setState({ kind: 'not-found' });
        else setState({ kind: 'failed', error: goal.messageKey });
        return;
      }
      if (goal.data.accountId !== null) {
        setState({
          kind: 'ready',
          goal: goal.data,
          entries: null,
          asked: ENTRIES_FIRST_LIMIT,
          returned: 0,
          loadingMore: false,
          moreError: null,
        });
        return;
      }
      const page = await api.listGoalEntries(goalId, { limit: ENTRIES_FIRST_LIMIT });
      if (stale()) return;
      if (page.ok) {
        setState({
          kind: 'ready',
          goal: goal.data,
          entries: page.data.entries,
          asked: ENTRIES_FIRST_LIMIT,
          returned: page.data.entries.length,
          loadingMore: false,
          moreError: null,
        });
      } else if (page.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else if (page.code === 'NOT_FOUND') setState({ kind: 'not-found' });
      else setState({ kind: 'failed', error: page.messageKey });
    })();
    return () => {
      run.active = false;
    };
  }, [api, goalId, router, attempt, validId]);

  if (state.kind === 'not-found') return <GoalNotFound />;

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

  const { goal, entries, asked, returned, loadingMore, moreError } = state;

  function loadMore() {
    if (loadingMore) return;
    const limit = nextEntriesLimit(asked);
    setState((current) =>
      current.kind === 'ready' ? { ...current, loadingMore: true, moreError: null } : current,
    );
    void api.listGoalEntries(goalId, { limit }).then((page) => {
      if (!page.ok && page.code === 'UNAUTHENTICATED') {
        router.replace('/sign-in');
        return;
      }
      setState((current) => {
        if (current.kind !== 'ready') return current;
        if (!page.ok) return { ...current, loadingMore: false, moreError: page.messageKey };
        return {
          ...current,
          entries: mergeEntries(page.data.entries, current.entries ?? []),
          asked: limit,
          returned: page.data.entries.length,
          loadingMore: false,
          moreError: null,
        };
      });
    });
  }

  function recorded(response: RecordGoalEntryResponse) {
    setState((current) =>
      current.kind === 'ready'
        ? {
            ...current,
            goal: response.goal,
            entries: [response.entry, ...(current.entries ?? [])],
          }
        : current,
    );
  }

  const shown = entries?.length ?? 0;
  return (
    <GoalDetailView
      goal={goal}
      entries={entries}
      hasMore={
        entries !== null && shown < GOAL_ENTRIES_PAGE_SIZE_MAX && canLoadMore(returned, asked)
      }
      loadingMore={loadingMore}
      moreError={moreError}
      onLoadMore={loadMore}
      onRecorded={recorded}
      onDeleted={() => {
        router.push('/goals');
      }}
    />
  );
}
