'use client';

import { CircleAlert, WifiOff } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';

export interface ReportLoadingProps {
  /** A screen-specific skeleton layout; a generic one is drawn without it. */
  children?: ReactNode;
}

/** The loading state: it announces itself once; the filter controls around it stay operable. */
export function ReportLoading({ children }: ReportLoadingProps) {
  const t = useTranslations('reports.states');
  return (
    <div role="status" aria-busy="true" className="grid gap-3">
      <span className="sr-only">{t('loading')}</span>
      {children ?? (
        <>
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </>
      )}
    </div>
  );
}

export interface ReportEmptyProps {
  /** `YYYY-MM-DD` start and end of the range the answer covered. */
  from: string;
  to: string;
  /** Asks the container to clear the dates. */
  onWiden: () => void;
}

/** No data in the range: names the range and offers to widen it or record a movement. */
export function ReportEmpty({ from, to, onWiden }: ReportEmptyProps) {
  const t = useTranslations('reports.states');
  const format = useFormatter();
  const day = (value: string) =>
    format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });
  return (
    <EmptyState
      title={t('emptyTitle')}
      description={t('emptyDescription', { from: day(from), to: day(to) })}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={onWiden}>
            {t('widen')}
          </Button>
          <Link href="/movements/new" className={buttonVariants({ variant: 'default' })}>
            {t('record')}
          </Link>
        </div>
      }
    />
  );
}

export interface ReportErrorProps {
  /** The retry request is in flight: the button is disabled. */
  retrying: boolean;
  onRetry: () => void;
}

/** The request failed: catalog text only, never the server's. */
export function ReportError({ retrying, onRetry }: ReportErrorProps) {
  const t = useTranslations('reports.states');
  return (
    <ErrorState
      title={t('errorTitle')}
      description={t('errorDescription')}
      retryLabel={retrying ? t('retrying') : t('retry')}
      onRetry={onRetry}
      retrying={retrying}
    />
  );
}

export interface ReportOfflineProps {
  onRetry: () => void;
}

/** The device is offline: reports are never kept, so there is nothing to show. */
export function ReportOffline({ onRetry }: ReportOfflineProps) {
  const t = useTranslations('reports.states');
  return (
    <EmptyState
      icon={<WifiOff aria-hidden />}
      title={t('offlineTitle')}
      description={t('offlineDescription')}
      action={<Button onClick={onRetry}>{t('offlineRetry')}</Button>}
    />
  );
}

export interface FilterGoneAlertProps {
  /** Asks the container to clear the account and tag filters. */
  onReload: () => void;
}

/** The account or tag filtered by no longer exists (404). */
export function FilterGoneAlert({ onReload }: FilterGoneAlertProps) {
  const t = useTranslations('reports.states');
  return (
    <Alert variant="warning">
      <CircleAlert aria-hidden />
      <AlertTitle>{t('filterGoneMessage')}</AlertTitle>
      <div className="col-start-2 mt-3">
        <Button variant="outline" size="sm" onClick={onReload}>
          {t('filterGoneReload')}
        </Button>
      </div>
    </Alert>
  );
}

/** The id the date fields point to when the server refused the range. */
export const RANGE_ALERT_ID = 'report-range-alert';

export interface RangeAlertProps {
  id?: string | undefined;
}

/** The server refused the date range (400 on `from` or `to`); figures stay hidden. */
export function RangeAlert({ id = RANGE_ALERT_ID }: RangeAlertProps) {
  const t = useTranslations('reports.states');
  return (
    <Alert id={id} variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>{t('badRangeMessage')}</AlertDescription>
    </Alert>
  );
}
