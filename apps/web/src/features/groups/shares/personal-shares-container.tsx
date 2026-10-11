'use client';

import type { PersonalShareResponse } from '@pesly/shared';
import { Receipt } from 'lucide-react';
import { useTimeZone, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { GroupIssue } from '../components/group-issue';
import { GroupsLoadStateView } from '../components/groups-load-state';
import { PersonalSharesList } from './personal-shares-list';
import { SharesRangeForm } from './shares-range-form';
import {
  buildSharesRequest,
  currentMonthRange,
  sumByCurrency,
  type SharesFieldErrors,
  type SharesRangeValues,
} from './shares-request';
import { SharesTotals } from './shares-totals';

type Bounds = { from: string; to: string };

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'failed'; error: ErrorMessageKey }
  | { kind: 'ready'; items: PersonalShareResponse[]; nextCursor: string | null };

/**
 * The user's own part of every group expense in a date range (FR-12). It starts on the current
 * month in the user's time zone and makes one request per page: the first on load or when the
 * range changes, the next ones through the cursor.
 */
export function PersonalSharesContainer() {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('groups.shares');
  const timeZone = useTimeZone() ?? 'UTC';
  const defaults = useMemo<SharesRangeValues>(
    () => currentMonthRange(new Date(), timeZone),
    [timeZone],
  );
  const [bounds, setBounds] = useState<Bounds>();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [fields, setFields] = useState<SharesFieldErrors>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreIssue, setMoreIssue] = useState<ApiFailure>();
  // Bumped whenever the first page is requested again, so a late "load more" answer is dropped.
  const generation = useRef(0);

  // The first range is the current month; it is applied once the time zone is known.
  const initial = useMemo(
    () => buildSharesRequest(defaults, timeZone).request,
    [defaults, timeZone],
  );
  const range = bounds ?? initial;

  useEffect(() => {
    if (range === undefined) return;
    let active = true;
    generation.current += 1;
    void api.listPersonalShares(range).then((result) => {
      if (!active) return;
      setLoadingMore(false);
      if (result.ok) {
        setState({ kind: 'ready', items: result.data.items, nextCursor: result.data.nextCursor });
      } else if (result.code === 'UNAUTHENTICATED') {
        router.replace('/sign-in');
      } else {
        setState({ kind: 'failed', error: result.messageKey });
      }
    });
    return () => {
      active = false;
    };
  }, [api, range, router, attempt]);

  function apply(values: SharesRangeValues) {
    const built = buildSharesRequest(values, timeZone);
    if (!built.request) {
      setFields(built.fields);
      return;
    }
    setFields(undefined);
    setMoreIssue(undefined);
    setState({ kind: 'loading' });
    setBounds(built.request);
  }

  async function loadMore(cursor: string) {
    if (range === undefined) return;
    setLoadingMore(true);
    setMoreIssue(undefined);
    const started = generation.current;
    const result = await api.listPersonalShares({ ...range, cursor });
    if (started !== generation.current) return;
    setLoadingMore(false);
    if (result.ok) {
      setState((current) =>
        current.kind === 'ready'
          ? {
              kind: 'ready',
              items: [...current.items, ...result.data.items],
              nextCursor: result.data.nextCursor,
            }
          : current,
      );
    } else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else setMoreIssue(result);
  }

  const totals = useMemo(() => (state.kind === 'ready' ? sumByCurrency(state.items) : []), [state]);

  return (
    <div className="grid gap-6">
      <PageHeader title={t('title')} description={t('description')} />
      <SharesRangeForm
        defaults={defaults}
        fields={fields}
        pending={state.kind === 'loading'}
        onSubmit={apply}
      />
      {state.kind !== 'ready' ? (
        <GroupsLoadStateView
          state={state}
          onRetry={() => {
            setState({ kind: 'loading' });
            setAttempt((current) => current + 1);
          }}
        />
      ) : state.items.length === 0 ? (
        <EmptyState
          icon={<Receipt aria-hidden="true" />}
          title={t('empty.title')}
          description={t('empty.description')}
        />
      ) : (
        <>
          <SharesTotals totals={totals} partial={state.nextCursor !== null} />
          {moreIssue ? <GroupIssue failure={moreIssue} /> : null}
          <PersonalSharesList
            items={state.items}
            timeZone={timeZone}
            hasMore={state.nextCursor !== null}
            loadingMore={loadingMore}
            onLoadMore={() => {
              if (state.nextCursor !== null) void loadMore(state.nextCursor);
            }}
          />
        </>
      )}
    </div>
  );
}
