import { cn } from '@/lib/utils';

export interface PillTabOption<T extends string> {
  value: T;
  label: string;
}

interface PillTabsProps<T extends string> {
  /** The accessible name of the group, e.g. "Range". */
  label: string;
  options: readonly PillTabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** A segmented control with pill styling: one option is pressed at a time. */
export function PillTabs<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: PillTabsProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      data-slot="pill-tabs"
      className={cn('inline-flex gap-0.5 rounded-pill bg-secondary p-0.5', className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              onChange(option.value);
            }}
            className={cn(
              'inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill px-3 text-small font-medium text-muted-foreground transition-colors outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring',
              selected && 'bg-card text-foreground shadow-xs',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
