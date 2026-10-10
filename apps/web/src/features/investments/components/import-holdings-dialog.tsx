'use client';

import {
  VALUATION_CURRENCIES,
  type HoldingResponse,
  type ImportHolding,
  type ImportPlan,
  type ValuationCurrency,
} from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ChangeEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormControl, FormItem, FormLabel, FormSelect } from '@/components/ui/form';
import type { Locale } from '@/i18n/routing';
import { formatQuantity } from '@/lib/format-amount';
import type { InvestmentErrorKey } from '../holding-form-errors';
import type { BalanzParseReason } from '../balanz-import/balanz-types';

export type ImportErrorKey = BalanzParseReason | 'duplicateTicker' | 'rejected';

/** What went wrong: a problem with the file (translated under `import.errors`) or with the API. */
export type ImportDialogError =
  | { scope: 'import'; key: ImportErrorKey; detail?: string }
  | { scope: 'api'; key: InvestmentErrorKey };

export type HoldingsImportPlan = ImportPlan<HoldingResponse, ImportHolding>;

export interface ImportHoldingsDialogProps {
  language: Locale;
  /** While true the confirm button is disabled and shows its pending label. */
  pending: boolean;
  /** While true the file is being read in the browser. */
  reading: boolean;
  /** What the import will do, with the currency each holding has now; null before a file is read. */
  plan: HoldingsImportPlan | null;
  error: ImportDialogError | null;
  onFile: (file: File) => void;
  onCurrencyChange: (ticker: string, currency: ValuationCurrency) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function ImportError({ error }: { error: ImportDialogError }) {
  const t = useTranslations('investments');
  const ref = useRef<HTMLDivElement>(null);
  // A new error is announced and focused once, like the form errors of this screen.
  useEffect(() => {
    ref.current?.focus();
  }, [error]);
  const message =
    error.scope === 'api'
      ? t(`errors.${error.key}`)
      : t(`import.errors.${error.key}`, { detail: error.detail ?? '' });
  return (
    <Alert ref={ref} variant="destructive" tabIndex={-1}>
      <CircleAlert aria-hidden />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function pickCurrency(value: string): ValuationCurrency {
  return VALUATION_CURRENCIES.find((code) => code === value) ?? 'ARS';
}

function HoldingLine({
  holding,
  language,
  onCurrencyChange,
}: {
  holding: ImportHolding;
  language: Locale;
  onCurrencyChange: ImportHoldingsDialogProps['onCurrencyChange'];
}) {
  const t = useTranslations('investments');
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="grid min-w-0 gap-0.5">
        <span className="font-medium">{holding.ticker}</span>
        <span className="truncate text-small text-muted-foreground">{holding.instrumentName}</span>
        <span className="flex gap-1 text-caption text-muted-foreground">
          <span>
            {t('import.preview.typeLabel', {
              type: t(`instrumentTypes.${holding.instrumentType}`),
            })}
          </span>
          <span aria-hidden>·</span>
          <span>{formatQuantity(BigInt(holding.quantity), language)}</span>
        </span>
      </div>
      <FormItem>
        <FormLabel className="sr-only">
          {t('import.preview.currencyFor', { ticker: holding.ticker })}
        </FormLabel>
        <FormSelect
          value={holding.valuationCurrency}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => {
            onCurrencyChange(holding.ticker, pickCurrency(event.target.value));
          }}
        >
          {VALUATION_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </FormSelect>
      </FormItem>
    </li>
  );
}

/**
 * The import of a Balanz holdings file as the last screen step: pick the file, review what will
 * be added, updated and removed, choose each holding's currency, then confirm. It is pure: reading
 * the file, planning and calling the API belong to its container. Every value from the file is
 * rendered as React text, never as HTML.
 */
export function ImportHoldingsDialog({
  language,
  pending,
  reading,
  plan,
  error,
  onFile,
  onCurrencyChange,
  onConfirm,
  onCancel,
}: ImportHoldingsDialogProps) {
  const tImport = useTranslations('investments.import');
  const hasHoldings = plan !== null && (plan.create.length > 0 || plan.update.length > 0);

  return (
    <div className="grid gap-4">
      <p className="text-small text-muted-foreground">{tImport('description')}</p>
      {error && <ImportError error={error} />}
      {reading && (
        <p role="status" className="text-small text-muted-foreground">
          {tImport('reading')}
        </p>
      )}
      <FormItem>
        <FormLabel>{tImport('fileLabel')}</FormLabel>
        <FormControl
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={reading || pending}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            // The same file can be chosen again after a fix; the input keeps no copy of it.
            event.target.value = '';
          }}
        />
      </FormItem>
      {plan !== null && (
        <section className="grid gap-4" aria-label={tImport('preview.heading')}>
          <h4 className="text-body font-medium">{tImport('preview.heading')}</h4>
          <p className="text-small">
            {tImport('preview.summary', {
              created: plan.create.length,
              updated: plan.update.length,
              removed: plan.remove.length,
            })}
          </p>
          {hasHoldings && (
            <p className="text-small text-muted-foreground">{tImport('preview.currencyNote')}</p>
          )}
          {plan.create.length > 0 && (
            <ul
              aria-label={tImport('preview.create')}
              className="grid divide-y divide-border/70 rounded-card bg-card px-4 shadow-xs"
            >
              {plan.create.map((holding) => (
                <HoldingLine
                  key={holding.ticker}
                  holding={holding}
                  language={language}
                  onCurrencyChange={onCurrencyChange}
                />
              ))}
            </ul>
          )}
          {plan.update.length > 0 && (
            <ul
              aria-label={tImport('preview.update')}
              className="grid divide-y divide-border/70 rounded-card bg-card px-4 shadow-xs"
            >
              {plan.update.map(({ incoming }) => (
                <HoldingLine
                  key={incoming.ticker}
                  holding={incoming}
                  language={language}
                  onCurrencyChange={onCurrencyChange}
                />
              ))}
            </ul>
          )}
          {plan.remove.length > 0 && (
            <div className="grid gap-2">
              <Alert variant="warning" role="note">
                <CircleAlert aria-hidden />
                <AlertDescription>{tImport('preview.removeWarning')}</AlertDescription>
              </Alert>
              <ul
                aria-label={tImport('preview.remove')}
                className="grid divide-y divide-border/70 rounded-card bg-card px-4 shadow-xs"
              >
                {plan.remove.map((holding) => (
                  <li key={holding.id} className="py-2 font-medium">
                    {holding.ticker}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        {plan !== null && (
          <Button type="button" disabled={pending} onClick={onConfirm}>
            {pending ? tImport('pending') : tImport('confirm')}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onCancel}>
          {tImport('cancel')}
        </Button>
      </div>
    </div>
  );
}
