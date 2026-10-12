'use client';

import {
  BUDGET_MAX_THRESHOLDS,
  BUDGET_THRESHOLD_MAX_PERCENT,
  BUDGET_THRESHOLD_MIN_PERCENT,
} from '@pesly/shared';
import { X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useId, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addThreshold, canAddThreshold, removeThreshold } from '../helpers/budget-thresholds';

interface BudgetThresholdsEditorProps {
  thresholds: readonly number[];
  /** A full catalog path from the form validation. */
  error: string | undefined;
  onChange: (thresholds: number[]) => void;
}

/** The alert thresholds as removable chips, plus an input to add a new whole percentage. */
export function BudgetThresholdsEditor({
  thresholds,
  error,
  onChange,
}: BudgetThresholdsEditorProps) {
  const t = useTranslations('budgets.form.thresholds');
  const tAll = useTranslations();
  const format = useFormatter();
  const base = useId();
  const [draft, setDraft] = useState('');
  const [addError, setAddError] = useState<string | undefined>();
  const message = addError ?? error;
  const messageId = `${base}-message`;

  // Display only: the percent formatter takes the 0-1 fraction of the whole number.
  const percent = (value: number) => format.number(value / 100, { style: 'percent' });

  function add() {
    const result = addThreshold(thresholds, draft);
    if (result.error !== undefined) {
      setAddError(result.error);
      return;
    }
    setAddError(undefined);
    setDraft('');
    onChange(result.list);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    // Enter would submit the whole form; here it means "add this threshold".
    event.preventDefault();
    add();
  }

  return (
    <div className="grid gap-2">
      <span className="text-small font-medium">{t('label')}</span>
      <ul className="flex flex-wrap gap-2">
        {thresholds.map((value) => (
          <li key={value} data-threshold={value}>
            <Button
              type="button"
              variant="outline"
              aria-label={t('remove', { percent: value })}
              onClick={() => {
                setAddError(undefined);
                onChange(removeThreshold(thresholds, value));
              }}
            >
              {percent(value)}
              <X aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      {canAddThreshold(thresholds) ? (
        <div className="grid gap-2">
          <Label htmlFor={`${base}-input`}>{t('input')}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={`${base}-input`}
              inputMode="numeric"
              autoComplete="off"
              value={draft}
              aria-invalid={Boolean(message)}
              aria-describedby={message ? `${base}-hint ${messageId}` : `${base}-hint`}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                setAddError(undefined);
              }}
              onKeyDown={handleKeyDown}
              className="w-auto flex-1"
            />
            <Button type="button" variant="secondary" onClick={add}>
              {t('add')}
            </Button>
          </div>
        </div>
      ) : null}
      <p id={`${base}-hint`} className="text-small text-muted-foreground">
        {t('hint', { min: BUDGET_THRESHOLD_MIN_PERCENT, max: BUDGET_THRESHOLD_MAX_PERCENT })}
      </p>
      {message ? (
        <p id={messageId} className="text-small text-destructive">
          {tAll(message, { max: BUDGET_MAX_THRESHOLDS })}
        </p>
      ) : null}
    </div>
  );
}
