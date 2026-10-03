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

export interface RegisterFormValues {
  displayName: string;
  email: string;
  password: string;
}

export interface RegisterFormProps {
  pending: boolean;
  errors: FormErrors;
  /** `GET /auth/google/start` on the API; without it the screen offers no Google sign-in. */
  googleStartUrl?: string;
  onSubmit: (values: RegisterFormValues) => void;
}

export function RegisterForm({ pending, errors, googleStartUrl, onSubmit }: RegisterFormProps) {
  const t = useTranslations('auth');
  const formRef = useFocusFirstInvalid(errors);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      displayName: readField(event.currentTarget, 'displayName'),
      email: readField(event.currentTarget, 'email'),
      password: readField(event.currentTarget, 'password'),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('register.title')}</CardTitle>
        <CardDescription>{t('register.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {googleStartUrl === undefined ? null : <GoogleSignInOption href={googleStartUrl} />}
        <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
          <FormAlert error={errors.form} />
          <AuthField
            label={t('fields.displayName')}
            name="displayName"
            type="text"
            autoComplete="name"
            required
            error={errors.fields?.displayName}
          />
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
            description={t('passwordHint')}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            error={errors.fields?.password}
          />
          <Button type="submit" disabled={pending}>
            {pending ? t('register.pending') : t('register.submit')}
          </Button>
          <p className="flex flex-wrap items-center justify-center gap-x-1 text-small text-muted-foreground">
            {t('register.haveAccount')}{' '}
            <Link
              href="/sign-in"
              className={buttonVariants({ variant: 'link', className: 'px-0' })}
            >
              {t('register.signInLink')}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
