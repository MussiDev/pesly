'use client';

import { useTranslations } from 'next-intl';
import { useId, type ReactNode, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { hasActiveFilters, type MovementFilterValues } from '../movement-filters-state';

export interface FilterAccountOption {
  id: string;
  label: string;
}

export interface FilterCategoryOption {
  id: string;
  label: string;
  /** A subcategory: shown indented under its parent, which comes right before it. */
  indent: boolean;
}

/** What the tag slot receives: the bar keeps one tag, so the box holds zero or one chip. */
export interface FilterTagFieldControl {
  value: readonly string[];
  onChange: (value: string[]) => void;
}

export interface MovementFiltersProps {
  filters: MovementFilterValues;
  accounts: readonly FilterAccountOption[];
  categories: readonly FilterCategoryOption[];
  /** The from date is after the to date: the list is not reloaded until it is fixed. */
  rangeInvalid: boolean;
  /** Receives the whole next filter set. */
  onChange: (next: MovementFilterValues) => void;
  onClear: () => void;
  /** Lets the container move focus here once a clear action removes the control that had it. */
  firstControlRef?: Ref<HTMLSelectElement> | undefined;
  /** Renders the tag box; the container supplies it so the bar stays presentational. */
  renderTagField?: ((control: FilterTagFieldControl) => ReactNode) | undefined;
}

const TYPES = ['expense', 'income'] as const;
const INDENT = '   ';

/** A copy of `filters` with `key` set, or unset when `value` is empty. */
function withValue<K extends keyof MovementFilterValues>(
  filters: MovementFilterValues,
  key: K,
  value: MovementFilterValues[K] | '',
): MovementFilterValues {
  return { ...filters, [key]: value === '' ? undefined : value };
}

/** The filter bar. It never fetches and never touches the URL: the container owns both. */
export function MovementFilters({
  filters,
  accounts,
  categories,
  rangeInvalid,
  onChange,
  onClear,
  firstControlRef,
  renderTagField,
}: MovementFiltersProps) {
  const t = useTranslations('movements');
  const id = useId();
  const rangeMessageId = `${id}-range`;

  return (
    <form
      role="search"
      aria-label={t('filters.title')}
      className="grid gap-3 rounded-lg border bg-card p-4 text-card-foreground"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${id}-account`}>{t('filters.account')}</Label>
        <Select
          ref={firstControlRef}
          id={`${id}-account`}
          value={filters.accountId ?? ''}
          onChange={(event) => {
            onChange(withValue(filters, 'accountId', event.currentTarget.value));
          }}
        >
          <option value="">{t('filters.allAccounts')}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-category`}>{t('filters.category')}</Label>
        <Select
          id={`${id}-category`}
          value={filters.categoryId ?? ''}
          onChange={(event) => {
            onChange(withValue(filters, 'categoryId', event.currentTarget.value));
          }}
        >
          <option value="">{t('filters.allCategories')}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.indent ? `${INDENT}${category.label}` : category.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-type`}>{t('filters.type')}</Label>
        <Select
          id={`${id}-type`}
          value={filters.type ?? ''}
          onChange={(event) => {
            const value = event.currentTarget.value;
            onChange(withValue(filters, 'type', TYPES.find((type) => type === value) ?? ''));
          }}
        >
          <option value="">{t('filters.allTypes')}</option>
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`types.${type}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-from`}>{t('filters.from')}</Label>
          <Input
            id={`${id}-from`}
            type="date"
            value={filters.from ?? ''}
            aria-invalid={rangeInvalid}
            aria-describedby={rangeInvalid ? rangeMessageId : undefined}
            onChange={(event) => {
              onChange(withValue(filters, 'from', event.currentTarget.value));
            }}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-to`}>{t('filters.to')}</Label>
          <Input
            id={`${id}-to`}
            type="date"
            value={filters.to ?? ''}
            aria-invalid={rangeInvalid}
            aria-describedby={rangeInvalid ? rangeMessageId : undefined}
            onChange={(event) => {
              onChange(withValue(filters, 'to', event.currentTarget.value));
            }}
          />
        </div>
      </div>
      {rangeInvalid ? (
        <p id={rangeMessageId} role="alert" className="text-sm text-destructive">
          {t('filters.invalidRange')}
        </p>
      ) : null}
      {renderTagField?.({
        value: filters.tag === undefined ? [] : [filters.tag],
        onChange: (tags) => {
          // One tag per filter: the newest choice replaces the previous one.
          onChange(withValue(filters, 'tag', tags.at(-1) ?? ''));
        },
      })}
      {hasActiveFilters(filters) ? (
        <Button type="button" variant="outline" onClick={onClear}>
          {t('filters.clear')}
        </Button>
      ) : null}
    </form>
  );
}
