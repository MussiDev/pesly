'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthField } from '@/features/auth/components/auth-field';
import { FormAlert } from '@/features/auth/components/form-alert';
import type { FormErrors } from '@/features/auth/form-errors';
import { readField } from '@/features/auth/read-field';
import { useFocusFirstInvalid } from '@/features/auth/use-focus-first-invalid';

export interface DeleteUserFormValues {
  password: string;
  code: string;
}

export interface DeleteUserFormProps {
  /** The account has a password: it is the proof. Off for the Google path, which already has one. */
  requirePassword: boolean;
  /** The account has two-step verification on. */
  requireCode: boolean;
  pending: boolean;
  errors: FormErrors;
  /** The fields as typed; the container validates them. */
  onSubmit: (values: DeleteUserFormValues) => void;
}

/** The permanent-deletion warning, the proofs the account needs and the destructive button. */
export function DeleteUserForm({
  requirePassword,
  requireCode,
  pending,
  errors,
  onSubmit,
}: DeleteUserFormProps) {
  const t = useTranslations('deleteUser');
  const formRef = useFocusFirstInvalid(errors);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({
      password: readField(event.currentTarget, 'password'),
      code: readField(event.currentTarget, 'code'),
    });
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2 text-destructive">
          <TriangleAlert aria-hidden className="size-5 shrink-0" />
          {t('warningTitle')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertDescription>{t('warning')}</AlertDescription>
          </Alert>
          <FormAlert error={errors.form} />
          {requirePassword ? (
            <AuthField
              label={t('password')}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              error={errors.fields?.password}
            />
          ) : null}
          {requireCode ? (
            <AuthField
              label={t('code')}
              description={t('codeHint')}
              name="code"
              type="text"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={16}
              required
              error={errors.fields?.code}
            />
          ) : null}
          <Button type="submit" variant="destructive" disabled={pending}>
            {pending ? t('pending') : t('submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
