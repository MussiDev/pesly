'use client';

import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { FormAlert } from '@/features/auth/components/form-alert';
import type { ErrorMessageKey } from '@/features/auth/form-errors';

const linkClass = 'text-primary underline-offset-4 hover:underline';

export interface DeleteUserGoogleProps {
  pending: boolean;
  /** Google did not confirm it is the user (the API sent the browser back with a failure flag). */
  failed: boolean;
  /** An API failure of the start or of the deletion, such as an expired confirmation. */
  error?: ErrorMessageKey;
  onStart: () => void;
}

/** The first step for an account without a password: confirm with Google before deleting. */
export function DeleteUserGoogle({ pending, failed, error, onStart }: DeleteUserGoogleProps) {
  const t = useTranslations('deleteUser');
  // An account with no password and no Google identity lands here and cannot tell itself apart
  // from a Google one, so the hint is always present and louder once the confirmation failed.
  const prominentHint = failed || error === 'reauthenticationRequired';
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2 text-destructive">
          <TriangleAlert aria-hidden className="size-5 shrink-0" />
          {t('warningTitle')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">{t('google.description')}</p>
        {failed ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{t('google.failed')}</AlertDescription>
          </Alert>
        ) : null}
        <FormAlert error={error} />
        {prominentHint ? (
          <Alert variant="info" role="note">
            <Info aria-hidden />
            <AlertTitle>{t('setPassword.title')}</AlertTitle>
            <AlertDescription>
              <p>{t('setPassword.body')}</p>
              <Link href="/forgot-password" className={linkClass}>
                {t('setPassword.link')}
              </Link>
            </AlertDescription>
          </Alert>
        ) : null}
        <Button type="button" variant="outline" disabled={pending} onClick={onStart}>
          {pending ? t('google.pending') : t('google.continue')}
        </Button>
        {prominentHint ? null : (
          <p className="text-sm text-muted-foreground">
            {t('setPassword.note')}{' '}
            <Link href="/forgot-password" className={linkClass}>
              {t('setPassword.link')}
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
