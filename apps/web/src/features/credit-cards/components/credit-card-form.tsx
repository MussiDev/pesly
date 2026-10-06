'use client';

import { CARD_NAME_MAX_LENGTH } from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Link } from '@/i18n/navigation';
import type { CardFieldMessage, CardFormErrors } from '../credit-card-form-errors';

export interface CreditCardFormValues {
  name: string;
  closingDay: string;
  dueDay: string;
}

interface CreditCardFormProps {
  pending: boolean;
  errors: CardFormErrors;
  onSubmit: (values: CreditCardFormValues) => void;
}

/** Name and default days of a new card; the container validates and sends it. */
export function CreditCardForm({ pending, errors, onSubmit }: CreditCardFormProps) {
  const t = useTranslations();
  const [values, setValues] = useState<CreditCardFormValues>({
    name: '',
    closingDay: '',
    dueDay: '',
  });
  const formRef = useRef<HTMLFormElement>(null);

  // After a failed submit, focus the first invalid field so its message is announced.
  useEffect(() => {
    if (!errors.fields) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const message = (key: CardFieldMessage | undefined) =>
    key ? t(key, { max: CARD_NAME_MAX_LENGTH }) : undefined;

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(values);
  }

  const field = (name: keyof CreditCardFormValues) => ({
    value: values[name],
    onChange: (event: { target: { value: string } }) => {
      setValues((current) => ({ ...current, [name]: event.target.value }));
    },
  });

  return (
    <form ref={formRef} noValidate onSubmit={submit} className="grid gap-5">
      <h1 className="text-title">{t('creditCards.form.title')}</h1>
      {errors.form ? (
        <Alert variant="destructive">
          <AlertDescription>{t(`errors.${errors.form}`)}</AlertDescription>
        </Alert>
      ) : null}
      <FormItem invalid={Boolean(errors.fields?.name)} hasDescription>
        <FormLabel>{t('creditCards.form.name')}</FormLabel>
        <FormControl autoComplete="off" maxLength={CARD_NAME_MAX_LENGTH * 2} {...field('name')} />
        <FormDescription>{t('creditCards.form.nameHint')}</FormDescription>
        <FormMessage>{message(errors.fields?.name)}</FormMessage>
      </FormItem>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormItem invalid={Boolean(errors.fields?.closingDay)} hasDescription>
          <FormLabel>{t('creditCards.form.closingDay')}</FormLabel>
          <FormControl
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            {...field('closingDay')}
          />
          <FormDescription>{t('creditCards.form.dayHint')}</FormDescription>
          <FormMessage>{message(errors.fields?.closingDay)}</FormMessage>
        </FormItem>
        <FormItem invalid={Boolean(errors.fields?.dueDay)} hasDescription>
          <FormLabel>{t('creditCards.form.dueDay')}</FormLabel>
          <FormControl type="number" inputMode="numeric" min={1} max={31} {...field('dueDay')} />
          <FormDescription>{t('creditCards.form.dayHint')}</FormDescription>
          <FormMessage>{message(errors.fields?.dueDay)}</FormMessage>
        </FormItem>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? t('creditCards.form.pending') : t('creditCards.form.submit')}
        </Button>
        <Link href="/cards" className={buttonVariants({ variant: 'ghost' })}>
          {t('creditCards.form.cancel')}
        </Link>
      </div>
    </form>
  );
}
