'use client';

import { type CreditCardResponse } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

export interface CardDaysValues {
  closingDay: string;
  dueDay: string;
  reminderDays: string;
}

export type CardDaysMessage =
  | 'creditCards.errors.dayInvalid'
  | 'creditCards.errors.reminderDaysInvalid'
  | 'creditCards.detail.daysConflict';

interface CardDaysFormProps {
  card: CreditCardResponse;
  pending: boolean;
  errors: Partial<Record<keyof CardDaysValues, CardDaysMessage>>;
  onSave: (values: CardDaysValues) => void;
}

/** The default closing and due days; saving moves the open statements too (FR-06). */
export function CardDaysForm({ card, pending, errors, onSave }: CardDaysFormProps) {
  const t = useTranslations();
  const [values, setValues] = useState<CardDaysValues>({
    closingDay: String(card.closingDay),
    dueDay: String(card.dueDay),
    reminderDays: String(card.reminderDays),
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(values);
  }

  const day = (name: 'closingDay' | 'dueDay', label: string) => (
    <FormItem invalid={Boolean(errors[name])}>
      <FormLabel>{label}</FormLabel>
      <FormControl
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={values[name]}
        onChange={(event) => {
          setValues((current) => ({ ...current, [name]: event.target.value }));
        }}
      />
      <FormMessage>{errors[name] ? t(errors[name]) : undefined}</FormMessage>
    </FormItem>
  );

  return (
    <form noValidate onSubmit={submit} className="grid gap-4 rounded-card bg-card p-4">
      <h2 className="text-heading">{t('creditCards.detail.days')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {day('closingDay', t('creditCards.form.closingDay'))}
        {day('dueDay', t('creditCards.form.dueDay'))}
      </div>
      <FormItem hasDescription>
        <FormDescription>{t('creditCards.detail.daysHint')}</FormDescription>
      </FormItem>
      <FormItem invalid={Boolean(errors.reminderDays)} hasDescription>
        <FormLabel>{t('creditCards.detail.reminderDays')}</FormLabel>
        <FormControl
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={values.reminderDays}
          onChange={(event) => {
            setValues((current) => ({ ...current, reminderDays: event.target.value }));
          }}
        />
        <FormDescription>{t('creditCards.detail.reminderDaysHint')}</FormDescription>
        <FormMessage>{errors.reminderDays ? t(errors.reminderDays) : undefined}</FormMessage>
      </FormItem>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {t('creditCards.detail.saveDays')}
        </Button>
      </div>
    </form>
  );
}
