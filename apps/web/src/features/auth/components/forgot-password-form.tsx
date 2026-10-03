'use client';

import { CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import type { FormErrors } from '../form-errors';
import { readField } from '../read-field';
import { useFocusFirstInvalid } from '../use-focus-first-invalid';
import { AuthField } from './auth-field';
import { FormAlert } from './form-alert';

export interface ForgotPasswordFormValues {
  email: string;
}

export interface ForgotPasswordFormProps {
  pending: boolean;
  errors: FormErrors;
  /** The request was accepted; shown the same whether or not the email is registered (AC-09). */
  sent?: boolean;
  onSubmit: (values: ForgotPasswordFormValues) => void;
}

export function ForgotPasswordForm({
  pending,
  errors,
  sent = false,
  onSubmit,
}: ForgotPasswordFormProps) {
  const t = useTranslations('auth');
  const formRef = useFocusFirstInvalid(errors);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({ email: readField(event.currentTarget, 'email') });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('forgotPassword.title')}</CardTitle>
        <CardDescription>{t('forgotPassword.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {sent ? (
          <Alert role="status">
            <CircleCheck aria-hidden />
            <AlertDescription>{t('forgotPassword.sent')}</AlertDescription>
          </Alert>
        ) : (
          <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
            <FormAlert error={errors.form} />
            <AuthField
              label={t('fields.email')}
              name="email"
              type="email"
              autoComplete="email"
              required
              error={errors.fields?.email}
            />
            <Button type="submit" disabled={pending}>
              {pending ? t('forgotPassword.pending') : t('forgotPassword.submit')}
            </Button>
          </form>
        )}
        <Link href="/sign-in" className={buttonVariants({ variant: 'link' })}>
          {t('forgotPassword.backToSignIn')}
        </Link>
      </CardContent>
    </Card>
  );
}
