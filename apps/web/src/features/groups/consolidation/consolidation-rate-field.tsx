'use client';

import type { RateType } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import type { ConsolidationFieldMessage } from '../settlements/consolidation-request';

export interface ConsolidationRateFieldProps {
  /** What the field shows: the typed text, or the stored rate formatted when nothing was typed. */
  value: string;
  rateType: RateType;
  /** The preview carried no stored rate: one must be typed. */
  missingStored: boolean;
  error?: ConsolidationFieldMessage;
  onChange: (value: string) => void;
}

/** The rate of the combination: the stored one prefilled, replaceable by a typed one. */
export function ConsolidationRateField({
  value,
  rateType,
  missingStored,
  error,
  onChange,
}: ConsolidationRateFieldProps) {
  const t = useTranslations('groups.consolidate');
  const tAll = useTranslations();
  const tRateTypes = useTranslations('profile.rateTypes');

  return (
    <FormItem invalid={error !== undefined} hasDescription>
      <FormLabel>{t('fields.rate')}</FormLabel>
      <FormControl
        name="rate"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <FormDescription>
        <span>{t('rate.type', { type: tRateTypes(rateType) })}</span>
        {missingStored ? <span> {t('rate.missing')}</span> : null}
      </FormDescription>
      <FormMessage>{error ? tAll(error) : undefined}</FormMessage>
    </FormItem>
  );
}
