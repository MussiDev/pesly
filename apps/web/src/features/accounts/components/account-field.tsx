'use client';

import { ACCOUNT_NAME_MAX_LENGTH } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import type { AccountFieldMessage } from '../account-form-errors';

export interface AccountFieldControlProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

interface AccountFieldProps {
  label: string;
  hint?: string;
  error: AccountFieldMessage | undefined;
  /** The `{max}` of the message when it is not the name length (the formatted amount limit). */
  max?: string;
  /** Renders the input or select with the id and ARIA attributes that tie it to label and message. */
  children: (control: AccountFieldControlProps) => ReactNode;
}

/**
 * A labelled control with its hint and inline error. Messages come from two catalog namespaces
 * (`accounts` and `errors`), so it translates by full path.
 */
export function AccountField({ label, hint, error, max, children }: AccountFieldProps) {
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
        <p id={`${id}-hint`} className="text-small text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-message`} className="text-small text-destructive">
          {t(error, { max: max ?? ACCOUNT_NAME_MAX_LENGTH })}
        </p>
      ) : null}
    </div>
  );
}
