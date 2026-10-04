'use client';

import type { RateType } from '@pesly/shared';
import { Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import type { MovementFieldMessage } from '../movement-form-errors';
import { MovementField } from './movement-field';

export interface RateFieldProps {
  /** The stored rate formatted for the locale; empty when there is none, which makes it required. */
  defaultValue: string;
  /** The rate type the stored rate belongs to. */
  rateType: RateType | undefined;
  /** Whole hours since the stored rate was fetched, only when it is old enough to warn about. */
  ageHours: number | undefined;
  error: MovementFieldMessage | undefined;
  /** An edit: the field shows the rate the movement has frozen, kept until the user changes it. */
  kept?: boolean;
  onEdited: () => void;
}

/** The exchange-rate input: prefilled from the stored rate, or empty and required without one. */
export function RateField({
  defaultValue,
  rateType,
  ageHours,
  error,
  kept = false,
  onEdited,
}: RateFieldProps) {
  const t = useTranslations();
  const required = defaultValue === '';

  const hint = (
    <>
      <p>
        {kept
          ? t('movements.rate.kept')
          : required || rateType === undefined
            ? t('movements.rate.missing')
            : t('movements.rate.automatic', { rateType: t(`profile.rateTypes.${rateType}`) })}
      </p>
      {kept || ageHours === undefined ? null : (
        <p role="status" className="flex items-center gap-1">
          <Clock className="size-4" aria-hidden />
          {t('movements.rate.age', { hours: ageHours })}
        </p>
      )}
    </>
  );

  return (
    <MovementField label={t('movements.fields.rate')} hint={hint} error={error}>
      {(control) => (
        <Input
          name="rate"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={defaultValue}
          required={required}
          onChange={onEdited}
          {...control}
        />
      )}
    </MovementField>
  );
}
