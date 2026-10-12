'use client';

import type { CategoryLanguage, CategoryResponse } from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { categoryLabel, compareCategories } from '@/features/categories/category-display';
import type { BudgetCategoriesState } from './use-budget-categories';

interface BudgetCategoryPickerProps {
  categories: BudgetCategoriesState;
  selected: readonly string[];
  /** A full catalog path. */
  error: string | undefined;
  onToggle: (id: string) => void;
  onRetry: () => void;
}

interface Group {
  parent: CategoryResponse;
  children: CategoryResponse[];
}

/** Expense categories only; a subcategory whose parent is not in the list stands on its own. */
function groupCategories(items: readonly CategoryResponse[]): Group[] {
  const expense = items
    .filter((item) => item.kind === 'expense' && !item.archived)
    .sort(compareCategories);
  const ids = new Set(expense.map((item) => item.id));
  const tops = expense.filter((item) => item.parentId === null || !ids.has(item.parentId));
  return tops.map((parent) => ({
    parent,
    children: expense.filter((item) => item.parentId === parent.id),
  }));
}

/** The user's expense categories as checkboxes, subcategories grouped under their parent. */
export function BudgetCategoryPicker({
  categories,
  selected,
  error,
  onToggle,
  onRetry,
}: BudgetCategoryPickerProps) {
  const t = useTranslations('budgets.form');
  const tAll = useTranslations();
  const language: CategoryLanguage = useLocale() === 'en' ? 'en' : 'es';
  const base = useId();
  const messageId = `${base}-message`;

  if (categories.kind === 'failed') {
    return (
      <div className="grid gap-2">
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t('categoriesError')}</AlertDescription>
        </Alert>
        <div>
          <Button type="button" variant="outline" onClick={onRetry}>
            {t('categoriesRetry')}
          </Button>
        </div>
      </div>
    );
  }

  const groups = categories.kind === 'ready' ? groupCategories(categories.items) : [];
  // A selected id the list does not offer (archived, or past the first page) stays visible so it
  // can be unchecked; otherwise it would be saved without the user ever seeing it.
  const offered = new Set(
    groups.flatMap(({ parent, children }) => [parent.id, ...children.map((c) => c.id)]),
  );
  const unavailable = categories.kind === 'ready' ? selected.filter((id) => !offered.has(id)) : [];
  let first = true;

  function row(category: { id: string }, label: string) {
    const id = `${base}-${category.id}`;
    const invalid = first && Boolean(error);
    first = false;
    return (
      <div key={category.id} className="flex min-h-11 items-center gap-3">
        <Checkbox
          id={id}
          checked={selected.includes(category.id)}
          aria-invalid={invalid}
          aria-describedby={invalid ? messageId : undefined}
          onChange={() => {
            onToggle(category.id);
          }}
        />
        <Label htmlFor={id}>{label}</Label>
      </div>
    );
  }

  return (
    <fieldset className="grid gap-2" aria-busy={categories.kind === 'loading'}>
      <legend className="mb-2 text-small font-medium">{t('categories')}</legend>
      {groups.map(({ parent, children }) => (
        <div key={parent.id} className="grid gap-1">
          {row(parent, categoryLabel(parent, language))}
          {children.length > 0 ? (
            <div
              role="group"
              aria-label={t('categoriesGroup', { parent: categoryLabel(parent, language) })}
              className="ml-8 grid gap-1"
            >
              {children.map((child) => row(child, categoryLabel(child, language)))}
            </div>
          ) : null}
        </div>
      ))}
      {unavailable.map((id) => row({ id }, t('categoryUnavailable')))}
      {error ? (
        <p id={messageId} className="text-small text-destructive">
          {tAll(error)}
        </p>
      ) : null}
    </fieldset>
  );
}
