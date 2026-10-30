'use client';

import { CREATABLE_MOVEMENT_TYPES, movementFilterShape } from '@pesly/shared';
import { useLocale, useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { MovementFilterValues } from '../movement-filters-state';

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
  firstControlRef?: Ref<HTMLButtonElement> | undefined;
  /** Renders the tag box; the container supplies it so the bar stays presentational. */
  renderTagField?: ((control: FilterTagFieldControl) => ReactNode) | undefined;
  /** Every control is off: the list is a copy kept on the device and cannot be filtered. */
  disabled?: boolean;
}

const INDENT = '   ';

interface DateFieldProps {
  id: string;
  value: string | undefined;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  onCommit: (value: string) => void;
}

/**
 * A date input that keeps what is being typed. The browser reports partial dates while the year is
 * typed (`0002-09-01`); those stay in the box and only a real day (or an empty box) becomes a
 * filter, because the URL round trip would drop the partial one and wipe the box.
 */
function DateField({ id, value, disabled, invalid, describedBy, onCommit }: DateFieldProps) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  return (
    <Input
      id={id}
      disabled={disabled}
      type="date"
      className="min-w-0"
      value={draft}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setDraft(next);
        if (next === '' || movementFilterShape.from.safeParse(next).success) onCommit(next);
      }}
    />
  );
}

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
  disabled = false,
}: MovementFiltersProps) {
  const t = useTranslations('movements');
  const id = useId();
  const rangeMessageId = `${id}-range`;
  // Until the person toggles the panel it follows the filters (open while one is set); after that it
  // stays where they left it, so an active filter no longer locks it open.
  const [userOpen, setUserOpen] = useState<boolean | undefined>(undefined);
  const panelCount = [
    filters.accountId,
    filters.categoryId,
    filters.from ?? filters.to,
    filters.tag,
    filters.hideAdjustments === 'true' ? 'true' : undefined,
  ].filter((value) => value !== undefined).length;
  const accountLabel = accounts.find((account) => account.id === filters.accountId)?.label;
  const categoryLabel = categories.find((category) => category.id === filters.categoryId)?.label;
  const locale = useLocale();
  // A filter day is a calendar date, so it is formatted in UTC to stay that same day.
  const day = (value: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00Z`),
    );
  const rangeLabel =
    filters.from !== undefined && filters.to !== undefined
      ? t('filters.rangeBetween', { from: day(filters.from), to: day(filters.to) })
      : filters.from !== undefined
        ? t('filters.rangeFrom', { from: day(filters.from) })
        : filters.to !== undefined
          ? t('filters.rangeTo', { to: day(filters.to) })
          : undefined;
  // What is on, besides the type: each one is a chip that takes it off.
  const activeChips: { key: string; label: string; without: MovementFilterValues }[] = [
    ...(filters.categoryId === undefined
      ? []
      : [
          {
            key: 'categoryId',
            label: categoryLabel ?? t('filters.category'),
            without: withValue(filters, 'categoryId', ''),
          },
        ]),
    ...(filters.accountId === undefined
      ? []
      : [
          {
            key: 'accountId',
            label: accountLabel ?? t('filters.account'),
            without: withValue(filters, 'accountId', ''),
          },
        ]),
    ...(rangeLabel === undefined
      ? []
      : [
          {
            key: 'range',
            label: rangeLabel,
            without: { ...filters, from: undefined, to: undefined },
          },
        ]),
    ...(filters.tag === undefined
      ? []
      : [{ key: 'tag', label: `#${filters.tag}`, without: withValue(filters, 'tag', '') }]),
    ...(filters.hideAdjustments === 'true'
      ? [
          {
            key: 'hideAdjustments',
            label: t('filters.hideAdjustments'),
            without: withValue(filters, 'hideAdjustments', ''),
          },
        ]
      : []),
  ];

  return (
    <form
      role="search"
      aria-label={t('filters.title')}
      className="grid gap-3 text-card-foreground"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <fieldset disabled={disabled} className="m-0 grid min-w-0 gap-3 border-0 p-0">
        <div
          role="group"
          aria-label={t('filters.type')}
          className="flex gap-2 overflow-x-auto pb-1"
        >
          {[undefined, ...CREATABLE_MOVEMENT_TYPES].map((type) => {
            const pressed = filters.type === type;
            return (
              <button
                key={type ?? 'all'}
                ref={type === undefined ? firstControlRef : undefined}
                type="button"
                disabled={disabled}
                aria-pressed={pressed}
                className={cn(
                  'inline-flex min-h-11 shrink-0 items-center rounded-pill px-4 text-small font-semibold whitespace-nowrap transition-colors outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                  pressed
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-foreground hover:bg-surface',
                )}
                onClick={() => {
                  onChange(withValue(filters, 'type', type ?? ''));
                }}
              >
                {type === undefined ? t('filters.all') : t(`types.${type}`)}
              </button>
            );
          })}
        </div>
        {activeChips.length === 0 ? null : (
          <ul role="list" aria-label={t('filters.active')} className="flex flex-wrap gap-2">
            {activeChips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={t('filters.remove', { name: chip.label })}
                  className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-pill bg-primary/10 pr-3 pl-4 text-small font-semibold text-primary transition-colors outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 motion-reduce:transition-none"
                  onClick={() => {
                    onChange(chip.without);
                  }}
                >
                  <span className="truncate">{chip.label}</span>
                  <X aria-hidden className="size-4 shrink-0" />
                </button>
              </li>
            ))}
            {activeChips.length > 0 ? (
              <li>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={onClear}
                >
                  {t('filters.clear')}
                </Button>
              </li>
            ) : null}
          </ul>
        )}
        <details
          open={userOpen ?? rangeInvalid}
          onToggle={(event) => {
            setUserOpen(event.currentTarget.open);
          }}
          className="rounded-card bg-card px-4 py-1 open:pb-4"
        >
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-small font-semibold">
            {t('filters.title')}
            {panelCount === 0 ? null : (
              <span className="inline-flex min-w-6 items-center justify-center rounded-pill bg-primary px-1.5 text-caption text-primary-foreground">
                <span aria-hidden="true">{panelCount}</span>
                <span className="sr-only">{t('filters.activeCount', { count: panelCount })}</span>
              </span>
            )}
          </summary>
          <div className="mt-2 grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-account`}>{t('filters.account')}</Label>
              <Select
                id={`${id}-account`}
                disabled={disabled}
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
                disabled={disabled}
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
            <div className="grid gap-3 min-[26rem]:grid-cols-2">
              <div className="grid min-w-0 gap-2">
                <Label htmlFor={`${id}-from`}>{t('filters.from')}</Label>
                <DateField
                  id={`${id}-from`}
                  disabled={disabled}
                  value={filters.from}
                  invalid={rangeInvalid}
                  describedBy={rangeInvalid ? rangeMessageId : undefined}
                  onCommit={(value) => {
                    onChange(withValue(filters, 'from', value));
                  }}
                />
              </div>
              <div className="grid min-w-0 gap-2">
                <Label htmlFor={`${id}-to`}>{t('filters.to')}</Label>
                <DateField
                  id={`${id}-to`}
                  disabled={disabled}
                  value={filters.to}
                  invalid={rangeInvalid}
                  describedBy={rangeInvalid ? rangeMessageId : undefined}
                  onCommit={(value) => {
                    onChange(withValue(filters, 'to', value));
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
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox
                id={`${id}-hide-adjustments`}
                disabled={disabled}
                checked={filters.hideAdjustments === 'true'}
                onChange={(event) => {
                  onChange(
                    withValue(
                      filters,
                      'hideAdjustments',
                      event.currentTarget.checked ? 'true' : '',
                    ),
                  );
                }}
              />
              <Label
                htmlFor={`${id}-hide-adjustments`}
                className="min-h-11 cursor-pointer items-center"
              >
                {t('filters.hideAdjustments')}
              </Label>
            </div>
          </div>
        </details>
      </fieldset>
    </form>
  );
}
