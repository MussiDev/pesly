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

/** Which code the user types: one from the authenticator app, or a recovery code. */
export type SecondFactorMode = 'totp' | 'recovery';

export interface SecondFactorFormProps {
  mode: SecondFactorMode;
  pending: boolean;
  errors: FormErrors;
  onSubmit: (code: string) => void;
  onModeChange: (mode: SecondFactorMode) => void;
}

/** The second step of a sign-in, after the password or Google (FR-04). */
export function SecondFactorForm({
  mode,
  pending,
  errors,
  onSubmit,
  onModeChange,
}: SecondFactorFormProps) {
  const t = useTranslations('auth.secondFactor');
  const formRef = useFocusFirstInvalid(errors);
  const recovery = mode === 'recovery';

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(readField(event.currentTarget, 'code'));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('title')}</CardTitle>
        <CardDescription>{recovery ? t('recoveryDescription') : t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
          <FormAlert error={errors.form} />
          <AuthField
            // A new input per mode: the typed value of one kind of code never carries over.
            key={mode}
            label={recovery ? t('recoveryCode') : t('code')}
            name="code"
            type="text"
            inputMode={recovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            autoCapitalize={recovery ? 'characters' : 'off'}
            spellCheck={false}
            maxLength={16}
            required
            error={errors.fields?.code}
          />
          <Button type="submit" disabled={pending}>
            {pending ? t('pending') : t('submit')}
          </Button>
          <Button
            variant="link"
            onClick={() => {
              onModeChange(recovery ? 'totp' : 'recovery');
            }}
          >
            {recovery ? t('useAuthenticator') : t('useRecoveryCode')}
          </Button>
          <Link href="/sign-in" className={buttonVariants({ variant: 'link' })}>
            {t('backToSignIn')}
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
