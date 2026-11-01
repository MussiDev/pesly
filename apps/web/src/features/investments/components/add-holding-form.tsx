'use client';

import {
  INSTRUMENT_TYPES,
  VALUATION_CURRENCIES,
  addHoldingRequestSchema,
  type AddHoldingRequest,
  type InstrumentType,
  type ValuationCurrency,
} from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { useState, type ChangeEvent, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { FormControl, FormItem, FormLabel, FormMessage, FormSelect } from '@/components/ui/form';
import { SegmentedField } from '@/components/ui/segmented-field';
import { readField } from '@/features/auth/read-field';
import type { Locale } from '@/i18n/routing';
import { parseAmountInput, parseQuantityInput } from '../decimal-input';
import {
  decimalErrorKey,
  type HoldingField,
  type HoldingFormErrors,
  type InvestmentErrorKey,
} from '../holding-form-errors';
import { useFieldErrors } from '../use-field-errors';
import { useFocusInvalid } from '../use-focus-invalid';
import { FormErrorAlert } from './form-error-alert';

export interface AddHoldingFormProps {
  /** The language numbers are typed in (decimal separator). */
  language: Locale;
  /** While true the form ignores submits and shows its pending label. */
  pending: boolean;
  /** API failure of the last request, from `toHoldingFailure(failure, 'add')`. */
  errors?: HoldingFormErrors;
  /**
   * Values already typed for the API: quantity in 10^-8 units and the cost in minor units.
   * The form keeps what the user typed after a failure and never resets itself, so the container
   * must unmount it after a successful save, or the next holding would start filled in.
   */
  onSubmit: (values: AddHoldingRequest) => void;
  onCancel?: () => void;
}

const SCHEMA_FIELD_ERRORS: Partial<Record<string, [HoldingField, InvestmentErrorKey]>> = {
  ticker: ['ticker', 'tickerInvalid'],
  instrumentName: ['instrumentName', 'instrumentNameRequired'],
  quantity: ['quantity', 'quantityInvalid'],
  totalCost: ['totalCost', 'amountInvalid'],
  valuationCurrency: ['valuationCurrency', 'cryptoOnlyUsd'],
};

/** The schema tells an empty instrument name from one over the limit by the kind of issue. */
function schemaError(issue: {
  path: readonly PropertyKey[];
  code: string;
}): [HoldingField, InvestmentErrorKey] | undefined {
  const field = String(issue.path[0]);
  if (field === 'instrumentName' && issue.code === 'too_big') {
    return ['instrumentName', 'instrumentNameTooLong'];
  }
  return SCHEMA_FIELD_ERRORS[field];
}

/** A select only offers listed values; anything else falls back to the given default. */
function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

/** A new holding: instrument, quantity, valuation currency and, optionally, what it cost. */
export function AddHoldingForm({
  language,
  pending,
  errors,
  onSubmit,
  onCancel,
}: AddHoldingFormProps) {
  const t = useTranslations('investments');
  const tForm = useTranslations('investments.forms.addHolding');
  const tErrors = useTranslations('investments.errors');
  const { fields, form: formError, focus, setLocal } = useFieldErrors(errors);
  const formRef = useFocusInvalid(focus);
  const [instrumentType, setInstrumentType] = useState<InstrumentType>('stock');
  const [currency, setCurrency] = useState<ValuationCurrency>('ARS');
  const isCrypto = instrumentType === 'crypto';

  function handleTypeChange(event: ChangeEvent<HTMLSelectElement>) {
    const next = pick(event.target.value, INSTRUMENT_TYPES, instrumentType);
    setInstrumentType(next);
    // Crypto is only valued in USD (FR-14).
    if (next === 'crypto') setCurrency('USD');
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const found: Partial<Record<HoldingField, InvestmentErrorKey>> = {};

    const quantity = parseQuantityInput(readField(form, 'quantity'), language);
    if (!quantity.ok) found.quantity = decimalErrorKey(quantity.error);

    const costText = readField(form, 'totalCost');
    const cost = costText.trim() === '' ? null : parseAmountInput(costText, language);
    if (cost && !cost.ok) found.totalCost = decimalErrorKey(cost.error);

    // A typed number that already failed is replaced by a valid stand-in, so the shared schema
    // only judges the rest.
    const parsed = addHoldingRequestSchema.safeParse({
      ticker: readField(form, 'ticker'),
      instrumentName: readField(form, 'instrumentName'),
      instrumentType,
      quantity: quantity.ok ? quantity.value : '1',
      valuationCurrency: currency,
      ...(cost?.ok ? { totalCost: cost.value } : {}),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const mapped = schemaError(issue);
        if (mapped && found[mapped[0]] === undefined) found[mapped[0]] = mapped[1];
      }
      // An issue on no field of the form must still be told to the user, never swallowed.
      setLocal(found, Object.keys(found).length === 0 ? 'unexpected' : undefined);
      return;
    }

    if (Object.keys(found).length > 0) {
      setLocal(found);
      return;
    }
    setLocal({});
    onSubmit(parsed.data);
  }

  function message(field: HoldingField): string | null {
    const key = fields[field];
    return key ? tErrors(key) : null;
  }

  return (
    <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
      <FormErrorAlert error={formError} />
      <FormItem invalid={Boolean(fields.ticker)}>
        <FormLabel>{tForm('ticker')}</FormLabel>
        <FormControl name="ticker" autoComplete="off" autoCapitalize="characters" />
        <FormMessage>{message('ticker')}</FormMessage>
      </FormItem>
      <FormItem invalid={Boolean(fields.instrumentName)}>
        <FormLabel>{tForm('instrumentName')}</FormLabel>
        <FormControl name="instrumentName" autoComplete="off" />
        <FormMessage>{message('instrumentName')}</FormMessage>
      </FormItem>
      <FormItem>
        <FormLabel>{tForm('instrumentType')}</FormLabel>
        <FormSelect name="instrumentType" value={instrumentType} onChange={handleTypeChange}>
          {INSTRUMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`instrumentTypes.${type}`)}
            </option>
          ))}
        </FormSelect>
      </FormItem>
      <FormItem invalid={Boolean(fields.quantity)}>
        <FormLabel>{tForm('quantity')}</FormLabel>
        <FormControl name="quantity" inputMode="decimal" autoComplete="off" />
        <FormMessage>{message('quantity')}</FormMessage>
      </FormItem>
      <SegmentedField
        label={tForm('currency')}
        name="valuationCurrency"
        options={VALUATION_CURRENCIES.map((code) => ({
          value: code,
          label: code,
          disabled: isCrypto && code !== 'USD',
        }))}
        value={currency}
        onChange={(code) => {
          setCurrency(code);
        }}
        error={message('valuationCurrency') ?? undefined}
      />
      <FormItem invalid={Boolean(fields.totalCost)}>
        <FormLabel>{tForm('totalCost')}</FormLabel>
        <FormControl name="totalCost" inputMode="decimal" autoComplete="off" />
        <FormMessage>{message('totalCost')}</FormMessage>
      </FormItem>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? tForm('pending') : tForm('submit')}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('forms.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
