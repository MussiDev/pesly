'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { useApiClient } from '@/lib/api-client-provider';
import { isOffline } from '@/lib/connectivity';
import { readSessionPointer } from '@/lib/local-store/session-pointer';
import { buildAttentionItems } from '../attention/attention-items';
import { useQueueAttention } from '../attention/use-queue-attention';
import { DashboardFrame, DashboardScreen } from '../components/dashboard-screen';
import { DashboardSkeleton } from '../components/dashboard-skeleton';
import { toDashboardView, toSeriesView } from '../contract/dashboard-adapter';
import type { DashboardView, SeriesPointView } from '../dashboard-view';
import { recallDashboard, rememberDashboard } from './dashboard-session-cache';

type SeriesData = SeriesPointView[] | null;

type DashboardState =
  | { kind: 'loading' }
  | { kind: 'failed'; retrying: boolean }
  | { kind: 'offline-empty'; retrying: boolean }
  | {
      kind: 'ready';
      view: DashboardView;
      /** Null when the series request failed: the chart shows its own retry. */
      points: SeriesData;
      seriesRetrying: boolean;
      /** True when the figures come from earlier in this session because the device is offline. */
      outOfDate: boolean;
    };

/**
 * Financial data lives in React state and in the session memory only. The dashboard and the net
 * worth series leave together in one tick and nothing else is requested for figures (FR-18).
 */
export function DashboardContainer() {
  const api = useApiClient();
  const router = useRouter();
  const t = useTranslations('dashboard');
  const locale = useLocale() as Locale;
  const otherLabel = t('categories.other');
  const queue = useQueueAttention();
  const [state, setState] = useState<DashboardState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    // A function, not the variable: TypeScript would narrow `active` to `true` across the await.
    const isActive = () => active;
    void (async () => {
      const [dashboard, series] = await Promise.all([api.getDashboard(), api.getNetWorthSeries()]);
      if (!isActive()) return;
      const expired = [dashboard, series].some(
        (answer) => !answer.ok && answer.code === 'UNAUTHENTICATED',
      );
      if (expired) {
        router.replace('/sign-in');
        return;
      }
      const userId = readSessionPointer()?.userId;
      if (!dashboard.ok) {
        if (dashboard.code === 'NETWORK' && isOffline()) {
          // Only the same user id gets its earlier answers back, and only while offline (D6).
          const remembered = userId === undefined ? undefined : recallDashboard(userId);
          setState(
            remembered === undefined
              ? { kind: 'offline-empty', retrying: false }
              : {
                  kind: 'ready',
                  view: remembered.view,
                  points: remembered.points,
                  seriesRetrying: false,
                  outOfDate: true,
                },
          );
          return;
        }
        setState({ kind: 'failed', retrying: false });
        return;
      }
      const view = toDashboardView(dashboard.data, { locale, otherLabel });
      const points = series.ok ? toSeriesView(series.data) : null;
      if (userId !== undefined) rememberDashboard(userId, { view, points });
      setState({ kind: 'ready', view, points, seriesRetrying: false, outOfDate: false });
    })();
    return () => {
      active = false;
    };
  }, [api, router, locale, otherLabel, attempt]);

  const retry = useCallback(() => {
    // Single-flight: the state stays on screen with its retry button disabled while both requests
    // are in flight.
    setState((current) =>
      current.kind === 'failed' || current.kind === 'offline-empty'
        ? { ...current, retrying: true }
        : { kind: 'loading' },
    );
    setAttempt((value) => value + 1);
  }, []);

  const retrySeries = useCallback(() => {
    setState((current) =>
      current.kind === 'ready' ? { ...current, seriesRetrying: true } : current,
    );
    void (async () => {
      const series = await api.getNetWorthSeries();
      if (!series.ok && series.code === 'UNAUTHENTICATED') {
        router.replace('/sign-in');
        return;
      }
      const points = series.ok ? toSeriesView(series.data) : null;
      setState((current) => {
        if (current.kind !== 'ready') return current;
        if (points !== null && !current.outOfDate) {
          const userId = readSessionPointer()?.userId;
          if (userId !== undefined) rememberDashboard(userId, { view: current.view, points });
        }
        return { ...current, points, seriesRetrying: false, outOfDate: current.outOfDate };
      });
    })();
  }, [api, router]);

  const attention = useMemo(
    () => (state.kind === 'ready' ? buildAttentionItems(state.view.actions, queue.queue) : []),
    [state, queue.queue],
  );

  if (state.kind === 'loading' || !queue.ready) return <DashboardSkeleton />;

  if (state.kind === 'failed' || state.kind === 'offline-empty') {
    return (
      <DashboardFrame>
        <ErrorState
          title={t(state.kind === 'failed' ? 'states.error' : 'states.offline')}
          retryLabel={t('states.retry')}
          retrying={state.retrying}
          onRetry={retry}
        />
      </DashboardFrame>
    );
  }

  return (
    <>
      {state.outOfDate ? (
        <Alert role="status" className="mb-4">
          <AlertDescription>{t('states.outOfDate')}</AlertDescription>
          <div className="col-start-2 mt-3">
            <Button variant="outline" size="sm" onClick={retry}>
              {t('states.retry')}
            </Button>
          </div>
        </Alert>
      ) : null}
      <DashboardScreen
        locale={locale}
        view={state.view}
        series={
          state.points === null
            ? { kind: 'failed', retrying: state.seriesRetrying, onRetry: retrySeries }
            : { kind: 'ready', points: state.points }
        }
        attention={attention}
      />
    </>
  );
}
