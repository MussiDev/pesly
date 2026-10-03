'use client';

import { Mail, ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { ListRow } from '@/components/ui/list-row';
import { FormAlert } from '@/features/auth/components/form-alert';
import { readField } from '@/features/auth/read-field';
import type { ProfileFormErrors } from '../profile-errors';
import { useFocusInvalid } from '../use-focus-invalid';
import { SavedNotice } from './saved-notice';

export interface ProfileFormProps {
  /** `null` when the user never set one: the field is then empty. */
  displayName: string | null;
  email: string;
  twoFactorEnabled: boolean;
  pending: boolean;
  /** The last submit was saved. */
  saved: boolean;
  errors: ProfileFormErrors;
  /** The name as typed; the container validates it. */
  onSubmit: (values: { displayName: string }) => void;
}

/** The editable display name, the email (read-only, FR-03) and whether 2FA is on. */
export function ProfileForm({
  displayName,
  email,
  twoFactorEnabled,
  pending,
  saved,
  errors,
  onSubmit,
}: ProfileFormProps) {
  const t = useTranslations('profile');
  const tErrors = useTranslations('profile.errors');
  const formRef = useFocusInvalid(errors);
  const nameError = errors.fields?.displayName;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({ displayName: readField(event.currentTarget, 'displayName') });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('account.title')}</CardTitle>
        <CardDescription>{t('account.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
          <SavedNotice saved={saved} />
          <FormAlert error={errors.form} />
          <FormItem invalid={Boolean(nameError)} hasDescription>
            <FormLabel>{t('account.displayName')}</FormLabel>
            <FormControl name="displayName" autoComplete="name" defaultValue={displayName ?? ''} />
            <FormDescription>{t('account.displayNameHint')}</FormDescription>
            <FormMessage>{nameError ? tErrors(nameError) : null}</FormMessage>
          </FormItem>
          <div className="divide-y divide-border border-y">
            <ListRow
              leading={<Mail aria-hidden className="size-4 text-muted-foreground" />}
              title={t('account.email')}
              description={<span className="block break-all whitespace-normal">{email}</span>}
            />
            <ListRow
              leading={
                twoFactorEnabled ? (
                  <ShieldCheck aria-hidden className="size-4 text-success" />
                ) : (
                  <ShieldOff aria-hidden className="size-4 text-muted-foreground" />
                )
              }
              title={t('account.twoFactor')}
              trailing={
                <Badge variant={twoFactorEnabled ? 'success' : 'default'}>
                  {twoFactorEnabled ? t('account.twoFactorOn') : t('account.twoFactorOff')}
                </Badge>
              }
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? t('account.pending') : t('account.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
