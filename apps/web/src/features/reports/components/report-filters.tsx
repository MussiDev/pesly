'use client';

import { useTranslations } from 'next-intl';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useCompactViewport } from '@/lib/use-compact-viewport';
import { cn } from '@/lib/utils';
import type { ReportAccountOption } from '../load-account-options';
import { activePreset, maxMonthsFor, presetsFor, rangeOfPreset, type RangePreset } from '../range';
import type { ReportFilterValues } from '../report-filters-state';
import type { ReportKind } from '../report-view';
import { rangeCheckFor } from '../use-report';
import { RANGE_ALERT_ID } from './report-states';

/** What the tag slot receives: the bar keeps one tag, so the box holds zero or one chip. */
export interface ReportTagFieldControl {
  value: readonly string[];
  onChange: (value: string[]) => void;
}

export interface ReportFiltersProps {
  kind: ReportKind;
  filters: ReportFilterValues;
  accounts: readonly ReportAccountOption[];
  /** The user's today; the presets stay off until it is known. */
  today: string | undefined;
  /** Receives the whole next filter set; never called with a range that fails the local check. */
  onChange: (next: ReportFilterValues) => void;
  /** Renders the tag box; the container supplies it so the bar stays presentational. */
  renderTagField?: ((control: ReportTagFieldControl) => ReactNode) | undefined;
  /** The date field the server refused; the body's range alert describes it. */
  serverField?: 'from' | 'to' | undefined;
}

/** A date pair the user typed that was not sent, kept so the fields show what was typed. */
interface Draft {
  baseFrom: string | undefined;
  baseTo: string | undefined;
  from: string | undefined;
  to: string | undefined;
}

const PRESET_KEY: Record<RangePreset, 'thisMonth' | 'last3' | 'last12' | 'last24'> = {
  thisMonth: 'thisMonth',
  last3: 'last3',
  last12: 'last12',
  last24: 'last24',
};

const CHIP =
  'inline-flex min-h-11 flex-auto items-center justify-center rounded-pill px-2 text-small font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

function activeCount(kind: ReportKind, filters: ReportFilterValues): number {
  const range = filters.from !== undefined || filters.to !== undefined ? 1 : 0;
  if (kind === 'netWorth') return range;
  return range + (filters.accountId === undefined ? 0 : 1) + (filters.tag === undefined ? 0 : 1);
}

/** The filter bar. It never fetches and never touches the address: the container owns both. */
export function ReportFilters({
  kind,
  filters,
  accounts,
  today,
  onChange,
  renderTagField,
  serverField,
}: ReportFiltersProps) {
  const t = useTranslations('reports');
  const id = useId();
  const messageId = `${id}-range`;
  const compact = useCompactViewport();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const flow = kind !== 'netWorth';

  // A draft belongs to the filters it was typed over; once those change it no longer applies.
  const liveDraft =
    draft !== null && draft.baseFrom === filters.from && draft.baseTo === filters.to ? draft : null;
  const shown = liveDraft ?? filters;
  const check = rangeCheckFor(kind, { from: shown.from, to: shown.to }, today);
  const invalid = !check.ok;
  const preset =
    today === undefined && (filters.from !== undefined || filters.to !== undefined)
      ? 'custom'
      : activePreset(filters, today ?? '', kind);
  const count = activeCount(kind, filters);

  const withDates = (from: string | undefined, to: string | undefined): ReportFilterValues => ({
    ...filters,
    from,
    to,
  });

  const typeDate = (field: 'from' | 'to', raw: string) => {
    const value = raw === '' ? undefined : raw;
    const from = field === 'from' ? value : shown.from;
    const to = field === 'to' ? value : shown.to;
    if (rangeCheckFor(kind, { from, to }, today).ok) {
      setDraft(null);
      onChange(withDates(from, to));
      return;
    }
    setDraft({ baseFrom: filters.from, baseTo: filters.to, from, to });
  };

  const message = !check.ok
    ? check.reason === 'from_after_to'
      ? t('range.errors.fromAfterTo')
      : check.reason === 'to_in_future'
        ? t('range.errors.toInFuture')
        : t('range.errors.tooLong', { months: check.maxMonths })
    : undefined;
  const messageNode =
    message === undefined ? null : (
      <p id={messageId} role="alert" className="text-sm text-destructive">
        {message}
      </p>
    );
  // The active account may be missing from the options (still loading, failed, deleted): the
  // control must keep showing it instead of falling back to "All accounts".
  const missingAccount =
    filters.accountId !== undefined && !accounts.some((account) => account.id === filters.accountId)
      ? filters.accountId
      : undefined;

  // The quick periods stay in view, as NorteAR's period switch; the rest waits behind "More filters".
  const presets = (
    <div
      role="group"
      aria-label={t('range.label')}
      className="flex flex-wrap gap-0.5 rounded-3xl bg-secondary p-0.5"
    >
      {presetsFor(kind).map((entry) => (
        <button
          key={entry}
          type="button"
          disabled={today === undefined}
          aria-pressed={preset === entry}
          className={cn(CHIP, preset === entry && 'bg-card text-foreground shadow-xs')}
          onClick={() => {
            if (today === undefined) return;
            setDraft(null);
            onChange({ ...filters, ...rangeOfPreset(entry, today) });
          }}
        >
          {t(`range.presets.${PRESET_KEY[entry]}`)}
        </button>
      ))}
    </div>
  );

  const body = (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        {(['from', 'to'] as const).map((field) => (
          <div key={field} className="grid gap-2">
            <Label htmlFor={`${id}-${field}`}>{t(`range.${field}`)}</Label>
            <Input
              id={`${id}-${field}`}
              type="date"
              value={shown[field] ?? ''}
              aria-invalid={invalid || serverField === field}
              aria-describedby={
                invalid ? messageId : serverField === field ? RANGE_ALERT_ID : undefined
              }
              onChange={(event) => {
                typeDate(field, event.currentTarget.value);
              }}
            />
          </div>
        ))}
      </div>
      <p className="text-small text-muted-foreground">
        {t('range.limit', { months: maxMonthsFor(kind) })}
      </p>
      {messageNode}
      {flow ? (
        <div className="grid gap-2">
          <Label htmlFor={`${id}-account`}>{t('filters.account')}</Label>
          <Select
            id={`${id}-account`}
            value={filters.accountId ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onChange({ ...filters, accountId: value === '' ? undefined : value });
            }}
          >
            <option value="">{t('filters.allAccounts')}</option>
            {missingAccount === undefined ? null : (
              <option value={missingAccount}>{t('filters.unknownAccount')}</option>
            )}
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {flow
        ? renderTagField?.({
            value: filters.tag === undefined ? [] : [filters.tag],
            onChange: (tags) => {
              // One tag per filter: the newest choice replaces the previous one.
              onChange({ ...filters, tag: tags.at(-1) });
            },
          })
        : null}
      {count > 0 ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setDraft(null);
            onChange({});
          }}
        >
          {t('filters.clear')}
        </Button>
      ) : null}
    </div>
  );

  return (
    <form
      role="search"
      aria-label={t('range.label')}
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      {presets}
      {compact ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-panel`}
            className="inline-flex min-h-11 items-center justify-self-start text-small font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              setOpen((value) => !value);
            }}
          >
            {t('filters.toggle', { count })}
          </button>
          {/* The panel holds the message while open; collapsed, it still shows beside the toggle. */}
          {open ? null : messageNode}
          <div
            id={`${id}-panel`}
            hidden={!open}
            className="rounded-card bg-card p-4 text-card-foreground"
          >
            {open ? body : null}
          </div>
        </>
      ) : (
        <div className="rounded-card bg-card p-4 text-card-foreground">{body}</div>
      )}
    </form>
  );
}
