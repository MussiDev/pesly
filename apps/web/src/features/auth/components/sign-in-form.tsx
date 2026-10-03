'use client';

import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import type { FormErrors } from '../form-errors';
import { readField } from '../read-field';
import { useFocusFirstInvalid } from '../use-focus-first-invalid';
import { AuthField } from './auth-field';
import { FormAlert } from './form-alert';
import { GoogleSignInOption } from './google-sign-in-button';

export interface SignInFormValues {
  email: string;
  password: string;
}

export interface SignInFormProps {
  pending: boolean;
  errors: FormErrors;
  /** `GET /auth/google/start` on the API; without it the screen offers no Google sign-in. */
  googleStartUrl?: string;
  onSubmit: (values: SignInFormValues) => void;
}

export function SignInForm({ pending, errors, googleStartUrl, onSubmit }: SignInFormProps) {
  const t = useTranslations('auth');
  const formRef = useFocusFirstInvalid(errors);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      email: readField(event.currentTarget, 'email'),
      password: readField(event.currentTarget, 'password'),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('signIn.title')}</CardTitle>
        <CardDescription>{t('signIn.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {googleStartUrl === undefined ? null : <GoogleSignInOption href={googleStartUrl} />}
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
          <AuthField
            label={t('fields.password')}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            error={errors.fields?.password}
          />
          <Button type="submit" disabled={pending}>
            {pending ? t('signIn.pending') : t('signIn.submit')}
          </Button>
          <div className="grid justify-items-center gap-1">
            <Link href="/forgot-password" className={buttonVariants({ variant: 'link' })}>
              {t('signIn.forgotPassword')}
            </Link>
            <p className="flex flex-wrap items-center justify-center gap-x-1 text-small text-muted-foreground">
              {t('signIn.noAccount')}{' '}
              <Link
                href="/register"
                className={buttonVariants({ variant: 'link', className: 'px-0' })}
              >
                {t('signIn.registerLink')}
              </Link>
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
