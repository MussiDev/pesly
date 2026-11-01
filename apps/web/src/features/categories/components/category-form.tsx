'use client';

import {
  CATEGORY_KINDS,
  type CategoryKind,
  type CategoryLanguage,
  type CategoryResponse,
} from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SegmentedField } from '@/components/ui/segmented-field';
import { FormAlert } from '@/features/auth/components/form-alert';
import { readField } from '@/features/auth/read-field';
import { useFocusInvalid } from '@/features/profile/use-focus-invalid';
import { categoryLabel, compareCategories } from '../category-display';
import type { CategoryFormErrors } from '../category-form-errors';
import { CategoryField } from './category-field';
import { ColorPicker, IconPicker } from './category-pickers';

/** The create form's name field, which the list's empty state sends the user to. */
export const NEW_CATEGORY_NAME_ID = 'new-category-name';

/** What the user typed or picked, untouched: the container validates it. */
export interface CategoryFormValues {
  kind: string;
  parentId: string;
  name: string;
  icon: string;
  color: string;
}

export interface CategoryFormProps {
  /** The active categories: the parent select lists the top-level ones of the chosen kind. */
  categories: readonly CategoryResponse[];
  language: CategoryLanguage;
  pending: boolean;
  errors: CategoryFormErrors;
  onSubmit: (values: CategoryFormValues) => void;
  /** The kind the form opens on: the tab the list shows. */
  defaultKind?: CategoryKind;
  /** Closes the form; without it there is no cancel button. */
  onCancel?: (() => void) | undefined;
}

export function CategoryForm({
  categories,
  language,
  pending,
  errors,
  onSubmit,
  defaultKind = 'expense',
  onCancel,
}: CategoryFormProps) {
  const t = useTranslations('categories');
  const tAll = useTranslations();
  const formRef = useFocusInvalid(errors);
  const [kind, setKind] = useState<CategoryKind>(defaultKind);

  // Opened from "New": the name is what the user came to type.
  useEffect(() => {
    if (onCancel !== undefined) document.getElementById(NEW_CATEGORY_NAME_ID)?.focus();
  }, [onCancel]);

  const parents = categories
    .filter((item) => item.kind === kind && item.parentId === null && !item.archived)
    .sort(compareCategories);

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSubmit({
      kind: readField(form, 'kind'),
      parentId: readField(form, 'parentId'),
      name: readField(form, 'name'),
      icon: readField(form, 'icon'),
      color: readField(form, 'color'),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t('new.title')}</CardTitle>
        <CardDescription>{t('new.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
          <FormAlert error={errors.form} />
          <SegmentedField
            label={t('fields.kind')}
            name="kind"
            options={CATEGORY_KINDS.map((option) => ({
              value: option,
              label: t(`kinds.${option}`),
            }))}
            value={kind}
            onChange={setKind}
            error={errors.fields?.kind ? tAll(errors.fields.kind) : undefined}
          />
          <CategoryField label={t('fields.parent')} error={errors.fields?.parentId}>
            {(control) => (
              // Remounted per kind: a parent of the other kind must not stay selected.
              <Select key={kind} name="parentId" defaultValue="" {...control}>
                <option value="">{t('fields.parentNone')}</option>
                {parents.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {categoryLabel(parent, language)}
                  </option>
                ))}
              </Select>
            )}
          </CategoryField>
          <CategoryField
            label={t('fields.name')}
            error={errors.fields?.name}
            id={NEW_CATEGORY_NAME_ID}
          >
            {(control) => (
              <Input name="name" type="text" autoComplete="off" required {...control} />
            )}
          </CategoryField>
          <CategoryField label={t('fields.icon')} error={errors.fields?.icon} group>
            {(control) => <IconPicker control={control} />}
          </CategoryField>
          <CategoryField label={t('fields.color')} error={errors.fields?.color} group>
            {(control) => <ColorPicker control={control} />}
          </CategoryField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? t('form.pending') : t('form.submit')}
            </Button>
            {onCancel === undefined ? null : (
              <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
                {t('actions.cancel')}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
