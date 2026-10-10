'use client';

import { cn } from '@/lib/utils';

interface CategoryChipsProps {
  /** The group's accessible name, shown as the field's label. */
  label: string;
  categories: readonly { id: string; label: string }[];
  defaultValue: string;
  invalid: boolean;
  describedBy: string | undefined;
}

/**
 * The categories of the chosen type as one row of chips that scrolls sideways. Each chip is a real
 * radio button, so the form reads `categoryId` like any other field and the keyboard works.
 */
export function CategoryChips({
  label,
  categories,
  defaultValue,
  invalid,
  describedBy,
}: CategoryChipsProps) {
  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0" aria-describedby={describedBy}>
      <legend
        data-error={invalid}
        className="mb-2 text-small font-medium data-[error=true]:text-destructive"
      >
        {label}
      </legend>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {categories.map((category) => (
          <label key={category.id} className="relative shrink-0 cursor-pointer">
            <input
              type="radio"
              name="categoryId"
              value={category.id}
              defaultChecked={category.id === defaultValue}
              required
              aria-invalid={invalid}
              className="peer sr-only"
            />
            <span
              className={cn(
                'inline-flex min-h-11 items-center rounded-pill border bg-card px-4 text-small font-semibold whitespace-nowrap transition-colors motion-reduce:transition-none',
                'peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                invalid && 'border-destructive',
              )}
            >
              {category.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
