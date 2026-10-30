'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CategoryVisual } from '@/features/categories/components/category-visual';
import { cn } from '@/lib/utils';

export interface CategoryChipOption {
  id: string;
  label: string;
  /** The parent category; `null` (or an id not among the options) makes it a top-level tile. */
  parentId?: string | null | undefined;
  icon?: string | undefined;
  color?: string | undefined;
}

interface CategoryChipsProps {
  /** The group's accessible name, shown as the field's label. */
  label: string;
  categories: readonly CategoryChipOption[];
  defaultValue: string;
  invalid: boolean;
  describedBy: string | undefined;
}

/**
 * The categories of the chosen type: the top-level ones as a grid of icon tiles, and the
 * subcategories of the tile in use as chips below it. Every option is a real radio button named
 * `categoryId`, so the form reads it like any other field and the keyboard works.
 */
export function CategoryChips({
  label,
  categories,
  defaultValue,
  invalid,
  describedBy,
}: CategoryChipsProps) {
  const t = useTranslations('movements.fields');
  const [selected, setSelected] = useState(defaultValue);
  const ids = new Set(categories.map((category) => category.id));
  const isTop = (category: CategoryChipOption) =>
    category.parentId === null || category.parentId === undefined || !ids.has(category.parentId);
  const parents = categories.filter(isTop);
  const childrenOf = (parentId: string) =>
    categories.filter((category) => !isTop(category) && category.parentId === parentId);
  const picked = categories.find((category) => category.id === selected);
  // The tile whose subcategories show: the picked one, or the parent of a picked subcategory.
  const openParent = picked === undefined ? undefined : isTop(picked) ? picked.id : picked.parentId;

  const radio = (category: CategoryChipOption) => (
    <input
      type="radio"
      name="categoryId"
      value={category.id}
      checked={selected === category.id}
      onChange={() => {
        setSelected(category.id);
      }}
      required
      aria-invalid={invalid}
      className="peer sr-only"
    />
  );

  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0" aria-describedby={describedBy}>
      <legend
        data-error={invalid}
        className="mb-2 text-small font-medium data-[error=true]:text-destructive"
      >
        {label}
      </legend>
      <div className="grid grid-cols-4 gap-2">
        {parents.map((category) => (
          <label key={category.id} className="relative min-w-0 cursor-pointer">
            {radio(category)}
            <span
              className={cn(
                'flex min-h-18 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-1 py-2 text-center transition-colors motion-reduce:transition-none',
                'peer-checked:border-primary peer-checked:bg-accent peer-checked:text-accent-foreground',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                openParent === category.id && 'border-primary',
                invalid && 'border-destructive',
              )}
            >
              <CategoryVisual
                icon={category.icon ?? ''}
                color={category.color ?? ''}
                className="size-8 [&>svg]:size-4"
              />
              <span className="line-clamp-2 w-full text-caption leading-tight font-semibold hyphens-auto">
                {category.label}
              </span>
            </span>
          </label>
        ))}
      </div>
      {parents.map((parent) => {
        const children = childrenOf(parent.id);
        if (children.length === 0) return null;
        return (
          <div
            key={parent.id}
            role="group"
            aria-label={t('subcategories', { name: parent.label })}
            hidden={openParent !== parent.id}
            className="flex flex-wrap gap-2 pt-1"
          >
            {children.map((category) => (
              <label key={category.id} className="relative cursor-pointer">
                {radio(category)}
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
        );
      })}
    </fieldset>
  );
}
