'use client';

import { CATEGORY_NAME_MAX_LENGTH } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import type { CategoryFieldMessage } from '../category-form-errors';

export interface CategoryFieldControlProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
  /** Set for a group of radios, whose label is not a `<label>` of one control. */
  'aria-labelledby': string | undefined;
}

interface CategoryFieldProps {
  label: string;
  error: CategoryFieldMessage | undefined;
  /** The control is a group (radiogroup): the label names the group instead of one input. */
  group?: boolean;
  /** A fixed id for the control, when something outside the form must find it. */
  id?: string;
  /** Renders the control with the id and ARIA attributes that tie it to label and message. */
  children: (control: CategoryFieldControlProps) => ReactNode;
}

/**
 * A labelled control with its inline error. Messages come from two catalog namespaces
 * (`categories` and `errors`), so it translates by full path.
 */
export function CategoryField({
  label,
  error,
  group = false,
  id: fixedId,
  children,
}: CategoryFieldProps) {
  const t = useTranslations();
  const generatedId = useId();
  const id = fixedId ?? generatedId;
  const labelId = `${id}-label`;

  return (
    <div className="grid gap-2">
      {group ? (
        <span
          id={labelId}
          data-error={Boolean(error)}
          className="text-small leading-none font-medium data-[error=true]:text-destructive"
        >
          {label}
        </span>
      ) : (
        <Label
          htmlFor={id}
          data-error={Boolean(error)}
          className="data-[error=true]:text-destructive"
        >
          {label}
        </Label>
      )}
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': error ? `${id}-message` : undefined,
        'aria-labelledby': group ? labelId : undefined,
      })}
      {error ? (
        <p id={`${id}-message`} className="text-small text-destructive">
          {t(error, { max: CATEGORY_NAME_MAX_LENGTH })}
        </p>
      ) : null}
    </div>
  );
}
