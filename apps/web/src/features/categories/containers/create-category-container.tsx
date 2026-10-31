'use client';

import {
  createCategoryRequestSchema,
  type CategoryKind,
  type CategoryLanguage,
  type CategoryResponse,
} from '@pesly/shared';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { CreateCategoryInput } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { nameErrorMessage, type CategoryFormErrors } from '../category-form-errors';
import { CategoryForm, type CategoryFormValues } from '../components/category-form';

type FieldErrors = NonNullable<CategoryFormErrors['fields']>;

export interface CreateCategoryContainerProps {
  /** The active categories, for the parent select. */
  categories: readonly CategoryResponse[];
  language: CategoryLanguage;
  onCreated: (created: CategoryResponse) => void;
  defaultKind?: CategoryKind;
  onCancel?: (() => void) | undefined;
}

/** Validates the form with the shared schema, creates the category and reports it. */
export function CreateCategoryContainer({
  categories,
  language,
  onCreated,
  defaultKind,
  onCancel,
}: CreateCategoryContainerProps) {
  const api = useApiClient();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<CategoryFormErrors>({});
  // Bumped after a success so the form remounts empty.
  const [formKey, setFormKey] = useState(0);

  /** The request to send, or the per-field messages explaining why there is none. */
  function validate(
    values: CategoryFormValues,
  ):
    | { request: CreateCategoryInput; fields?: undefined }
    | { request?: undefined; fields: FieldErrors } {
    const parsed = createCategoryRequestSchema.safeParse({
      name: values.name,
      kind: values.kind,
      icon: values.icon,
      color: values.color,
      ...(values.parentId === '' ? {} : { parentId: values.parentId }),
    });
    if (parsed.success) return { request: parsed.data };

    const fields: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'name') fields.name ??= nameErrorMessage(values.name);
      else if (field === 'kind') fields.kind ??= 'categories.errors.kindInvalid';
      else if (field === 'parentId') fields.parentId ??= 'categories.errors.parentInvalid';
      else if (field === 'icon') fields.icon ??= 'categories.errors.iconRequired';
      else if (field === 'color') fields.color ??= 'categories.errors.colorRequired';
    }
    return { fields };
  }

  async function create(values: CategoryFormValues) {
    const { request, fields } = validate(values);
    if (request === undefined) {
      setErrors({ fields });
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.createCategory(request);
    setPending(false);
    if (result.ok) {
      setFormKey((key) => key + 1);
      onCreated(result.data);
    } else if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
    } else if (result.code === 'CATEGORY_NAME_TAKEN') {
      setErrors({ fields: { name: 'errors.categoryNameTaken' } });
    } else if (result.code === 'CATEGORY_NESTING_TOO_DEEP') {
      setErrors({ fields: { parentId: 'errors.categoryNestingTooDeep' } });
    } else if (result.code === 'CATEGORY_PARENT_KIND_MISMATCH') {
      setErrors({ fields: { parentId: 'errors.categoryParentKindMismatch' } });
    } else {
      // Network and unexpected failures: the form stays mounted, so the typed values stay.
      setErrors({ form: result.messageKey });
    }
  }

  return (
    <CategoryForm
      key={formKey}
      categories={categories}
      language={language}
      pending={pending}
      errors={errors}
      {...(defaultKind === undefined ? {} : { defaultKind })}
      onCancel={onCancel}
      onSubmit={(values) => {
        void create(values);
      }}
    />
  );
}
