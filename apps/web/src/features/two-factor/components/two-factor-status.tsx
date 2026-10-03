'use client';

import { CircleCheck, ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import { FormAlert } from '@/features/auth/components/form-alert';
import type { ErrorMessageKey } from '@/features/auth/form-errors';
import { useFocusHeading } from '../use-focus-heading';

export type TwoFactorStatusState =
  | { kind: 'loading' }
  | { kind: 'failed'; error: ErrorMessageKey }
  | { kind: 'ready'; enabled: boolean; recoveryCodesRemaining: number };

/** What the last enable or disable did, confirmed until the screen changes. */
export type TwoFactorNotice = 'enabled' | 'disabled';

export interface TwoFactorStatusProps {
  /** Focus the heading on mount: set when this view replaced another one. */
  focusHeading?: boolean;
  state: TwoFactorStatusState;
  /** The setup is being started. */
  pending: boolean;
  notice?: TwoFactorNotice;
  error?: ErrorMessageKey;
  onEnable: () => void;
  onDisable: () => void;
  onRetry: () => void;
}

/** Whether 2FA is on, how many recovery codes are left (never the codes), and how to change it. */
export function TwoFactorStatus({
  focusHeading = false,
  state,
  pending,
  notice,
  error,
  onEnable,
  onDisable,
  onRetry,
}: TwoFactorStatusProps) {
  const t = useTranslations('security');
  const tApp = useTranslations('app');
  const tUi = useTranslations('ui');
  const tErrors = useTranslations('errors');
  const headingRef = useFocusHeading(focusHeading);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" ref={headingRef} tabIndex={-1} className="outline-none">
          {t('twoFactor.title')}
        </CardTitle>
        <CardDescription>{t('twoFactor.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {notice ? (
          <Alert variant="success" role="status">
            <CircleCheck aria-hidden />
            <AlertDescription>
              {t(notice === 'enabled' ? 'enabledNotice' : 'disabledNotice')}
            </AlertDescription>
          </Alert>
        ) : null}
        {state.kind === 'failed' ? null : <FormAlert error={error} />}
        {state.kind === 'loading' ? (
          <div role="status" aria-busy="true" className="grid gap-4">
            <span className="sr-only">{tApp('loading')}</span>
            <Skeleton className="h-16" />
            <Skeleton className="h-11" />
          </div>
        ) : null}
        {state.kind === 'failed' ? (
          <ErrorState
            title={tUi('error.title')}
            description={tErrors(state.error)}
            retryLabel={tApp('retry')}
            onRetry={onRetry}
          />
        ) : null}
        {state.kind === 'ready' ? (
          <>
            <ListRow
              className="border-y"
              leading={
                state.enabled ? (
                  <ShieldCheck aria-hidden className="size-5 text-success" />
                ) : (
                  <ShieldOff aria-hidden className="size-5 text-muted-foreground" />
                )
              }
              title={t('twoFactor.status')}
              description={
                state.enabled ? (
                  <span className="block whitespace-normal">
                    {t('twoFactor.recoveryCodesRemaining', { count: state.recoveryCodesRemaining })}
                  </span>
                ) : undefined
              }
              trailing={
                <Badge variant={state.enabled ? 'success' : 'default'}>
                  {state.enabled ? t('twoFactor.on') : t('twoFactor.off')}
                </Badge>
              }
            />
            {state.enabled ? (
              <Button variant="outline" onClick={onDisable}>
                {t('twoFactor.disable')}
              </Button>
            ) : (
              <Button disabled={pending} onClick={onEnable}>
                {pending ? t('twoFactor.starting') : t('twoFactor.enable')}
              </Button>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
