'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** This one option cannot be picked (e.g. ARS for a crypto holding). */
  disabled?: boolean;
}

interface SegmentedFieldProps<T extends string> {
  /** The visible field label; it also names the radio group. */
  label: string;
  /** The form field name: the checked option is read from the form like any other field. */
  name: string;
  options: readonly SegmentedOption<T>[];
  /** Controlled value; leave it out (with `defaultValue`) for an uncontrolled field. */
  value?: T | '' | undefined;
  /** The initially checked option of an uncontrolled field; none is checked when it is left out. */
  defaultValue?: T | '' | undefined;
  onChange?: ((value: T) => void) | undefined;
  disabled?: boolean | undefined;
  /** Help text under the options. */
  hint?: ReactNode;
  /** The already translated error, shown under the options and announced with the group. */
  error?: string | undefined;
  className?: string | undefined;
}

/**
 * A short, fixed choice (two to four options, such as a currency or a frequency) shown as one
 * segmented row instead of a closed select: every option is visible and one tap picks it (Hick's
 * law). Each option is a native radio button named `name`, so arrow keys, form reading and
 * validation work as for any other field.
 */
export function SegmentedField<T extends string>({
  label,
  name,
  options,
  value,
  defaultValue,
  onChange,
  disabled = false,
  hint,
  error,
  className,
}: SegmentedFieldProps<T>) {
  const id = useId();
  const labelId = `${id}-label`;
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-message` : null].filter(Boolean).join(' ') ||
    undefined;
  const controlled = value !== undefined;

  return (
    <div data-slot="segmented-field" className={cn('grid gap-2', className)}>
      <span
        id={labelId}
        data-error={Boolean(error)}
        className="text-small leading-none font-medium data-[error=true]:text-destructive"
      >
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cn(
          'grid auto-cols-fr grid-flow-col gap-1 rounded-pill bg-surface p-1',
          error && 'ring-2 ring-destructive',
        )}
      >
        {options.map((option) => (
          <label
            key={option.value}
            htmlFor={`${id}-${option.value}`}
            className="relative min-w-0 cursor-pointer"
          >
            <input
              id={`${id}-${option.value}`}
              type="radio"
              name={name}
              value={option.value}
              disabled={disabled || option.disabled === true}
              {...(controlled
                ? { checked: value === option.value }
                : { defaultChecked: defaultValue === option.value })}
              onChange={() => {
                onChange?.(option.value);
              }}
              className="peer sr-only"
            />
            <span
              className={cn(
                'flex min-h-11 items-center justify-center rounded-pill px-2 text-center text-small leading-tight font-semibold text-foreground transition-colors motion-reduce:transition-none',
                'peer-checked:bg-primary peer-checked:text-primary-foreground',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                'hover:bg-card active:bg-card/60 peer-checked:hover:bg-primary/90',
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
      {hint ? (
        <div id={`${id}-hint`} className="text-small text-muted-foreground">
          {hint}
        </div>
      ) : null}
      {error ? (
        <p id={`${id}-message`} className="text-small text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
