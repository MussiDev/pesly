'use client';

import type { Notice } from '@pesly/shared';
import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { NoticeList } from '../components/notice-list';
import { notifyNoticesChanged } from '../notices-events';

const PAGE_SIZE = 20;

type ScreenState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; items: Notice[]; nextCursor: string | null; unreadCount: number };

type Problem = 'load' | 'markRead';

/** The notices screen: newest first, "load more" with the cursor, mark one or all as read. */
export function NoticesContainer() {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('notices');
  const tUi = useTranslations('ui');
  const tApp = useTranslations('app');
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [problem, setProblem] = useState<Problem | undefined>();

  useEffect(() => {
    let active = true;
    void api.listNotices({ limit: PAGE_SIZE }).then((result) => {
      if (!active) return;
      if (result.ok) {
        setState({
          kind: 'ready',
          items: result.data.items,
          nextCursor: result.data.nextCursor,
          unreadCount: result.data.unreadCount,
        });
      } else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else setState({ kind: 'failed' });
    });
    return () => {
      active = false;
    };
  }, [api, router, attempt]);

  /** `true` when the session is gone and the user was sent to sign in. */
  function leftForSignIn(failure: ApiFailure): boolean {
    if (failure.code !== 'UNAUTHENTICATED') return false;
    router.replace('/sign-in');
    return true;
  }

  /** Changes the read mark of some notices and keeps the unread number in step with it. */
  function setReadAt(ids: ReadonlySet<string> | 'all', readAt: string | null) {
    setState((current) => {
      if (current.kind !== 'ready') return current;
      let unreadCount = current.unreadCount;
      const items = current.items.map((item) => {
        const hit = ids === 'all' || ids.has(item.id);
        if (!hit || (item.readAt === null) === (readAt === null)) return item;
        unreadCount += readAt === null ? 1 : -1;
        return { ...item, readAt };
      });
      return { ...current, items, unreadCount: ids === 'all' ? 0 : Math.max(unreadCount, 0) };
    });
  }

  async function open(notice: Notice) {
    if (notice.readAt !== null) return;
    setProblem(undefined);
    setReadAt(new Set([notice.id]), new Date().toISOString());
    const result = await api.markNoticeRead(notice.id);
    if (result.ok) {
      notifyNoticesChanged();
      return;
    }
    setReadAt(new Set([notice.id]), null);
    if (!leftForSignIn(result)) setProblem('markRead');
  }

  async function markAll() {
    if (state.kind !== 'ready') return;
    setProblem(undefined);
    const result = await api.markAllNoticesRead();
    if (result.ok) {
      setReadAt('all', new Date().toISOString());
      notifyNoticesChanged();
    } else if (!leftForSignIn(result)) {
      setProblem('markRead');
    }
  }

  async function loadMore() {
    if (state.kind !== 'ready' || state.nextCursor === null || loadingMore) return;
    setProblem(undefined);
    setLoadingMore(true);
    const result = await api.listNotices({ limit: PAGE_SIZE, cursor: state.nextCursor });
    setLoadingMore(false);
    if (!result.ok) {
      if (!leftForSignIn(result)) setProblem('load');
      return;
    }
    const { items, nextCursor, unreadCount } = result.data;
    setState((current) => {
      if (current.kind !== 'ready') return current;
      const known = new Set(current.items.map((item) => item.id));
      return {
        kind: 'ready',
        items: [...current.items, ...items.filter((item) => !known.has(item.id))],
        nextCursor,
        unreadCount,
      };
    });
  }

  if (state.kind === 'loading') {
    return (
      <div role="status" aria-busy="true" className="grid gap-3">
        <span className="sr-only">{tApp('loading')}</span>
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }

  if (state.kind === 'failed') {
    return (
      <ErrorState
        title={tUi('error.title')}
        description={t('errors.load')}
        retryLabel={t('retry')}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  if (state.items.length === 0) {
    return (
      <EmptyState icon={<Bell aria-hidden="true" />} title={t('title')} description={t('empty')} />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-small text-muted-foreground">
          {t('unreadCount', { count: state.unreadCount })}
        </p>
        {state.unreadCount > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void markAll();
            }}
          >
            {t('markAllRead')}
          </Button>
        ) : null}
      </div>
      {problem === undefined ? null : (
        <Alert variant="destructive">
          <AlertDescription>{t(`errors.${problem}`)}</AlertDescription>
        </Alert>
      )}
      <NoticeList
        notices={state.items}
        onOpen={(notice) => {
          void open(notice);
        }}
      />
      {state.nextCursor === null ? null : (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={loadingMore}
            onClick={() => {
              void loadMore();
            }}
          >
            {t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
