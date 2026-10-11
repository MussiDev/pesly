'use client';

import type { GroupCategoryResponse } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import type { SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CategoryField } from '@/features/categories/components/category-field';
import { ColorPicker, IconPicker } from '@/features/categories/components/category-pickers';
import { readField } from '@/features/auth/read-field';
import { useFocusInvalid } from '@/features/profile/use-focus-invalid';
import type { GroupCategoryFieldErrors, GroupCategoryFormValues } from '../category-request';

export interface GroupCategoryFormProps {
  /** Set to edit this category; absent to create one. */
  category?: GroupCategoryResponse;
  /** The name to show as the current one (a default's catalog name). */
  label?: string;
  pending: boolean;
  fields: GroupCategoryFieldErrors | undefined;
  onSubmit: (values: GroupCategoryFormValues) => void;
  onCancel?: () => void;
}

/** Create or edit form: name, icon and color. The container validates what is submitted. */
export function GroupCategoryForm({
  category,
  label,
  pending,
  fields,
  onSubmit,
  onCancel,
}: GroupCategoryFormProps) {
  const t = useTranslations('groups.categories');
  const tCategories = useTranslations('categories');
  const formRef = useFocusInvalid({ fields });
  const editing = category !== undefined;

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSubmit({
      name: readField(form, 'name'),
      icon: readField(form, 'icon'),
      color: readField(form, 'color'),
    });
  }

  const form = (
    <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
      <CategoryField label={tCategories('fields.name')} error={fields?.name}>
        {(control) => (
          <Input
            name="name"
            type="text"
            autoComplete="off"
            required
            defaultValue={label}
            aria-label={
              editing ? tCategories('actions.editField', { name: label ?? '' }) : undefined
            }
            {...control}
          />
        )}
      </CategoryField>
      <CategoryField label={tCategories('fields.icon')} error={fields?.icon} group>
        {(control) => <IconPicker control={control} defaultValue={category?.icon} />}
      </CategoryField>
      <CategoryField label={tCategories('fields.color')} error={fields?.color} group>
        {(control) => <ColorPicker control={control} defaultValue={category?.color} />}
      </CategoryField>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {editing ? tCategories('actions.save') : pending ? t('pending') : t('submit')}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
            {tCategories('actions.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );

  if (editing) return form;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('new.title')}</CardTitle>
        <CardDescription>{t('new.description')}</CardDescription>
      </CardHeader>
      <CardContent>{form}</CardContent>
    </Card>
  );
}
