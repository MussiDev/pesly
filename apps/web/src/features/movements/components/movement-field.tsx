'use client';

import { MOVEMENT_NOTE_MAX_LENGTH } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import type { MovementFieldMessage } from '../movement-form-errors';

export interface MovementFieldControlProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

interface MovementFieldProps {
  label: string;
  hint?: ReactNode;
  error: MovementFieldMessage | undefined;
  /** Renders the control with the id and ARIA attributes that tie it to label, hint and message. */
  children: (control: MovementFieldControlProps) => ReactNode;
}

/**
 * A labelled control with its hint and inline error. Messages come from two catalog namespaces
 * (`movements` and `errors`), so it translates by full path.
 */
export function MovementField({ label, hint, error, children }: MovementFieldProps) {
  const t = useTranslations();
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-message` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="grid gap-2">
      <Label
        htmlFor={id}
        data-error={Boolean(error)}
        className="data-[error=true]:text-destructive"
      >
        {label}
      </Label>
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': describedBy || undefined,
      })}
      {hint ? (
        <div id={`${id}-hint`} className="text-small text-muted-foreground">
          {hint}
        </div>
      ) : null}
      {error ? (
        <p id={`${id}-message`} className="text-small text-destructive">
          {t(error, { max: MOVEMENT_NOTE_MAX_LENGTH })}
        </p>
      ) : null}
    </div>
  );
}
