'use client';

import { Landmark } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ChangeEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface AccountPickerProps {
  id: string;
  name: string;
  /** The picked account's name and currency, or `undefined` while none is picked. */
  picked: { name: string; currency: string } | undefined;
  defaultValue: string;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  /** The `<option>` elements, placeholder first. */
  children: ReactNode;
}

/**
 * A card that shows the picked account with a "Change" cue. The native select lies over it, fully
 * transparent, so a tap opens the system picker and the keyboard and screen readers keep a select.
 */
export function AccountPicker({
  id,
  name,
  picked,
  defaultValue,
  invalid,
  describedBy,
  onChange,
  children,
}: AccountPickerProps) {
  const t = useTranslations('movements.fields');

  return (
    <div
      className={cn(
        'relative flex min-h-16 items-center gap-3 rounded-2xl bg-surface px-4 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
        invalid && 'ring-2 ring-destructive',
      )}
    >
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-accent text-accent-foreground"
      >
        <Landmark className="size-4.5" />
      </span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate text-small font-semibold">
          {picked === undefined ? t('accountPlaceholder') : picked.name}
        </span>
        {picked === undefined ? null : (
          <span className="text-caption text-muted-foreground">{picked.currency}</span>
        )}
      </span>
      <span className="text-caption font-semibold text-primary">{t('accountChange')}</span>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        required
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={onChange}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      >
        {children}
      </select>
    </div>
  );
}
