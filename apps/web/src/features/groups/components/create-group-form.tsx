'use client';

import { GROUP_NAME_MAX_LENGTH, RATE_TYPES } from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { readField } from '@/features/auth/read-field';
import { MovementField } from '@/features/movements/components/movement-field';
import { Link } from '@/i18n/navigation';
import type { GroupFormErrors } from '../group-failure';
import type { GroupFormValues } from '../group-request';

interface CreateGroupFormProps {
  /** The rate type selected first. */
  defaultRateType: string;
  pending: boolean;
  errors: GroupFormErrors;
  onSubmit: (values: GroupFormValues) => void;
}

/** The name and the default rate type of a new group. */
export function CreateGroupForm({
  defaultRateType,
  pending,
  errors,
  onSubmit,
}: CreateGroupFormProps) {
  const t = useTranslations('groups.list');
  const tRate = useTranslations('profile.rateTypes');
  const tAll = useTranslations();
  const formRef = useRef<HTMLFormElement>(null);

  // After a failed submit, focus the first invalid field so its message is announced with it.
  useEffect(() => {
    if (!errors.fields) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSubmit({
      name: readField(form, 'name'),
      defaultRateType: readField(form, 'defaultRateType'),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t('createTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} noValidate onSubmit={handleSubmit} className="grid gap-4">
          {errors.form ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{tAll(errors.form)}</AlertDescription>
            </Alert>
          ) : null}
          <MovementField label={t('fields.name')} error={errors.fields?.name}>
            {(control) => (
              <Input
                name="name"
                autoComplete="off"
                maxLength={GROUP_NAME_MAX_LENGTH * 2}
                {...control}
              />
            )}
          </MovementField>
          <MovementField
            label={t('fields.rateType')}
            hint={t('fields.rateTypeHint')}
            error={errors.fields?.defaultRateType}
          >
            {(control) => (
              <Select name="defaultRateType" defaultValue={defaultRateType} {...control}>
                {RATE_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {tRate(value)}
                  </option>
                ))}
              </Select>
            )}
          </MovementField>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? t('pending') : t('submit')}
            </Button>
            <Link href="/groups" className={buttonVariants({ variant: 'ghost' })}>
              {t('cancel')}
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
