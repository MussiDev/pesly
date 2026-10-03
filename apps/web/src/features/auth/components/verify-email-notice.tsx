'use client';

import { CircleCheck, MailCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import type { FormErrors } from '../form-errors';
import { FormAlert } from './form-alert';

export type ResendStatus = 'idle' | 'pending' | 'sent';

interface ResendProps {
  resendStatus: ResendStatus;
  errors: FormErrors;
  onResend: () => void;
}

function ResendConfirmation({ message }: { message: string }) {
  return (
    <Alert role="status">
      <CircleCheck aria-hidden />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** "Check your email": after registering, and for signed-in users whose email is unverified (AC-04). */
export function VerifyEmailNotice({ resendStatus, errors, onResend }: ResendProps) {
  const t = useTranslations('auth.checkYourEmail');

  return (
    <Card>
      <CardHeader>
        <MailCheck aria-hidden className="size-8 text-muted-foreground" />
        <CardTitle as="h1">{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormAlert error={errors.form} />
        {resendStatus === 'sent' ? <ResendConfirmation message={t('resent')} /> : null}
        <Button variant="outline" disabled={resendStatus === 'pending'} onClick={onResend}>
          {resendStatus === 'pending' ? t('resending') : t('resend')}
        </Button>
        <Link href="/sign-in" className={buttonVariants({ variant: 'link' })}>
          {t('backToSignIn')}
        </Link>
      </CardContent>
    </Card>
  );
}

export type VerificationStatus = 'verifying' | 'verified' | 'failed';

interface VerifyEmailStatusProps extends ResendProps {
  status: VerificationStatus;
}

/** Result of opening a verification link; a failed link offers a new one (AC-06). */
export function VerifyEmailStatus({
  status,
  resendStatus,
  errors,
  onResend,
}: VerifyEmailStatusProps) {
  const t = useTranslations('auth.verifyEmail');

  if (status === 'verified') {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h1">{t('verifiedTitle')}</CardTitle>
          <CardDescription>{t('verified')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/" className={buttonVariants({ className: 'w-full' })}>
            {t('continue')}
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('title')}</CardTitle>
        {status === 'verifying' ? (
          <CardDescription role="status">{t('verifying')}</CardDescription>
        ) : null}
      </CardHeader>
      {status === 'failed' ? (
        <CardContent className="grid gap-4">
          <FormAlert error={errors.form} />
          {resendStatus === 'sent' ? <ResendConfirmation message={t('resent')} /> : null}
          <Button variant="outline" disabled={resendStatus === 'pending'} onClick={onResend}>
            {resendStatus === 'pending' ? t('resending') : t('resend')}
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}
