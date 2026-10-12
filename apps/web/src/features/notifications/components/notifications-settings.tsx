'use client';

import { Bell, BellOff, CircleAlert, Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';

/** What the screen shows for this device. */
export type NotificationsView =
  | { kind: 'loading' }
  | { kind: 'config-failed' }
  | { kind: 'unavailable' }
  | { kind: 'unsupported' }
  | { kind: 'blocked' }
  /** iPhone or iPad outside the Home Screen: the control is shown, the explanation follows a tap. */
  | { kind: 'ios-needs-install'; explained: boolean }
  | { kind: 'off' }
  | { kind: 'on' };

/** The last action that failed; the retry repeats it. */
export type NotificationsError = 'enable' | 'disable' | 'sync';

export interface NotificationsSettingsProps {
  view: NotificationsView;
  error?: NotificationsError;
  /** An enable or disable is in flight. */
  pending: boolean;
  /** The pending action, to word the busy button. */
  pendingAction?: 'enable' | 'disable';
  offline: boolean;
  onEnable: () => void;
  onDisable: () => void;
  /** Repeats the failed action, or reloads the configuration. */
  onRetry: () => void;
}

/** Whether this device gets push notifications, and how to change it. Fetches nothing. */
export function NotificationsSettings({
  view,
  error,
  pending,
  pendingAction,
  offline,
  onEnable,
  onDisable,
  onRetry,
}: NotificationsSettingsProps) {
  const t = useTranslations('notifications');
  const tApp = useTranslations('app');
  const tUi = useTranslations('ui');

  const enabled = view.kind === 'on';
  const canChange = view.kind === 'off' || view.kind === 'on' || view.kind === 'ios-needs-install';

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('card.title')}</CardTitle>
        <CardDescription>{t('card.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {view.kind === 'loading' ? (
          <div role="status" aria-busy="true" className="grid gap-4">
            <span className="sr-only">{tApp('loading')}</span>
            <Skeleton className="h-16" />
            <Skeleton className="h-11" />
          </div>
        ) : null}
        {view.kind === 'config-failed' ? (
          <ErrorState
            title={tUi('error.title')}
            description={t('errors.config')}
            retryLabel={tApp('retry')}
            onRetry={onRetry}
          />
        ) : null}
        {view.kind === 'unsupported' ? (
          <Alert>
            <Smartphone aria-hidden />
            <AlertTitle>{t('unsupported.title')}</AlertTitle>
            <AlertDescription>{t('unsupported.description')}</AlertDescription>
          </Alert>
        ) : null}
        {view.kind === 'unavailable' ? (
          <Alert>
            <BellOff aria-hidden />
            <AlertTitle>{t('unavailable.title')}</AlertTitle>
            <AlertDescription>{t('unavailable.description')}</AlertDescription>
          </Alert>
        ) : null}
        {view.kind === 'blocked' ? (
          <Alert variant="destructive">
            <BellOff aria-hidden />
            <AlertTitle>{t('blocked.title')}</AlertTitle>
            <AlertDescription>{t('blocked.help')}</AlertDescription>
          </Alert>
        ) : null}
        {view.kind === 'ios-needs-install' && view.explained ? (
          <Alert role="status">
            <Smartphone aria-hidden />
            <AlertTitle>{t('install.title')}</AlertTitle>
            <AlertDescription>{t('install.description')}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive" role="alert">
            <CircleAlert aria-hidden />
            <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
            <div className="col-start-2 mt-3">
              <Button variant="outline" size="sm" onClick={onRetry} disabled={pending || offline}>
                {tApp('retry')}
              </Button>
            </div>
          </Alert>
        ) : null}
        {view.kind === 'on' || view.kind === 'off' ? (
          <ListRow
            className="border-y"
            leading={
              enabled ? (
                <Bell aria-hidden className="size-5 text-success" />
              ) : (
                <BellOff aria-hidden className="size-5 text-muted-foreground" />
              )
            }
            title={t('status.label')}
            trailing={
              <Badge variant={enabled ? 'success' : 'default'}>
                {enabled ? t('status.on') : t('status.off')}
              </Badge>
            }
          />
        ) : null}
        {canChange && offline ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('offline')}
          </p>
        ) : null}
        {enabled ? (
          <Button variant="outline" disabled={pending || offline} onClick={onDisable}>
            {pending && pendingAction === 'disable' ? t('actions.disabling') : t('actions.disable')}
          </Button>
        ) : null}
        {canChange && !enabled ? (
          <Button disabled={pending || offline} onClick={onEnable}>
            {pending && pendingAction === 'enable' ? t('actions.enabling') : t('actions.enable')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
