'use client';

import {
  QUANTITY_SCALE,
  VALUATION_CURRENCIES,
  formatScaledDecimal,
  updateHoldingRequestSchema,
  type HoldingResponse,
  type UpdateHoldingRequest,
  type ValuationCurrency,
} from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormControl, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
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

const MINOR_UNIT_SCALE = 100n;

export interface EditHoldingFormProps {
  /**
   * The saved holding the fields start from and the changes are measured against. The inputs are
   * initialised once, so the container must remount the form per holding (`key={holding.id}`),
   * or they keep showing the values of the previous one.
   */
  holding: Pick<HoldingResponse, 'quantity' | 'totalCost' | 'valuationCurrency' | 'instrumentType'>;
  /** The language numbers are typed in (decimal separator). */
  language: Locale;
  /** While true the form ignores submits and shows its pending label. */
  pending: boolean;
  /** API failure of the last request, from `toHoldingFailure(failure, 'edit')`. */
  errors?: HoldingFormErrors;
  /** Only the changed fields; a changed currency always travels with the total cost (or `null`). */
  onSubmit: (values: UpdateHoldingRequest) => void;
  /**
   * Called by the cancel button and also when the form is saved with nothing changed, so the
   * container should treat it as "close the form", not as "the user gave up".
   */
  onCancel?: () => void;
}

const SCHEMA_FIELD_ERRORS: Partial<Record<string, [HoldingField, InvestmentErrorKey]>> = {
  quantity: ['quantity', 'quantityInvalid'],
  totalCost: ['totalCost', 'amountInvalid'],
};

/** A saved integer as typed text: no grouping, so it parses back as the same number. */
function typedDecimal(scaled: bigint, scale: bigint, language: Locale): string {
  const text = formatScaledDecimal(scaled, scale);
  return language === 'es' ? text.replace('.', ',') : text;
}

/** Quantity, total cost and currency of an existing holding. */
export function EditHoldingForm({
  holding,
  language,
  pending,
  errors,
  onSubmit,
  onCancel,
}: EditHoldingFormProps) {
  const t = useTranslations('investments.forms');
  const tForm = useTranslations('investments.forms.editHolding');
  const tErrors = useTranslations('investments.errors');
  const { fields, form: formError, focus, setLocal } = useFieldErrors(errors);
  const formRef = useFocusInvalid(focus);
  const [currency, setCurrency] = useState<ValuationCurrency>(holding.valuationCurrency);
  const originalCost =
    holding.totalCost === null
      ? ''
      : typedDecimal(BigInt(holding.totalCost), MINOR_UNIT_SCALE, language);
  const [cost, setCost] = useState(originalCost);
  const currencyChanged = currency !== holding.valuationCurrency;

  /**
   * The saved total cost is in the old currency, so it must never travel with a new one. Leaving
   * the saved currency empties the cost input (the notice asks to enter it again; an empty cost is
   * sent as an explicit `null`, which the API requires on a currency change). Going back to the
   * saved currency restores the saved cost, so nothing is sent for it.
   */
  function changeCurrency(next: ValuationCurrency) {
    const willChange = next !== holding.valuationCurrency;
    if (!currencyChanged && willChange) setCost('');
    else if (currencyChanged && !willChange) setCost(originalCost);
    setCurrency(next);
  }
  const isCrypto = holding.instrumentType === 'crypto';

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const found: Partial<Record<HoldingField, InvestmentErrorKey>> = {};
    const update: UpdateHoldingRequest = {};

    const quantity = parseQuantityInput(readField(form, 'quantity'), language);
    if (!quantity.ok) found.quantity = decimalErrorKey(quantity.error);
    else if (quantity.value !== holding.quantity) update.quantity = quantity.value;

    const costText = readField(form, 'totalCost');
    const cost = costText.trim() === '' ? null : parseAmountInput(costText, language);
    if (cost && !cost.ok) found.totalCost = decimalErrorKey(cost.error);
    else {
      const totalCost = cost === null ? null : cost.value;
      if (currencyChanged || totalCost !== holding.totalCost) update.totalCost = totalCost;
    }
    if (currencyChanged) update.valuationCurrency = currency;

    if (Object.keys(found).length > 0) {
      setLocal(found);
      return;
    }

    if (Object.keys(update).length === 0) {
      setLocal({});
      onCancel?.();
      return;
    }
    const parsed = updateHoldingRequestSchema.safeParse(update);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const mapped = SCHEMA_FIELD_ERRORS[String(issue.path[0])];
        if (mapped && found[mapped[0]] === undefined) found[mapped[0]] = mapped[1];
      }
      // An issue on no field of the form must still be told to the user, never swallowed.
      setLocal(found, Object.keys(found).length === 0 ? 'unexpected' : undefined);
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
      <FormItem invalid={Boolean(fields.quantity)}>
        <FormLabel>{tForm('quantity')}</FormLabel>
        <FormControl
          name="quantity"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={typedDecimal(BigInt(holding.quantity), QUANTITY_SCALE, language)}
        />
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
          changeCurrency(code);
        }}
        error={message('valuationCurrency') ?? undefined}
      />
      {/* Always mounted: a live region only announces what is added after it exists. */}
      <div role="status" className="empty:sr-only">
        {currencyChanged && (
          <Alert role={undefined}>
            <CircleAlert aria-hidden />
            <AlertDescription>{tForm('currencyChangeNotice')}</AlertDescription>
          </Alert>
        )}
      </div>
      <FormItem invalid={Boolean(fields.totalCost)}>
        <FormLabel>{tForm('totalCost')}</FormLabel>
        <FormControl
          name="totalCost"
          inputMode="decimal"
          autoComplete="off"
          value={cost}
          onChange={(event) => {
            setCost(event.target.value);
          }}
        />
        <FormMessage>{message('totalCost')}</FormMessage>
      </FormItem>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? tForm('pending') : tForm('submit')}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
