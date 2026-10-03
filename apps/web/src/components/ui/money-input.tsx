'use client';

import { useLocale } from 'next-intl';
import type { ChangeEvent, ComponentProps, FocusEvent } from 'react';
import { formatMoneyInput, trimTrailingDecimal } from '@/lib/money-input';
import { Input } from './input';

interface MoneyInputProps extends Omit<ComponentProps<typeof Input>, 'type' | 'inputMode'> {
  allowNegative?: boolean;
}

/**
 * A text input that adds the thousands separators as the user types, so "3000" becomes "3.000" in
 * Spanish and "3,000" in English and only the decimal separator has to be typed. It stays an
 * uncontrolled field: the form still reads the formatted text and `parseAmountInput` still owns
 * the validation.
 */
export function MoneyInput({ allowNegative = false, onChange, onBlur, ...props }: MoneyInputProps) {
  const locale = useLocale();

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const { text, caret } = formatMoneyInput(
      input.value,
      input.selectionStart ?? input.value.length,
      {
        locale,
        allowNegative,
      },
    );
    if (text !== input.value) {
      input.value = text;
      input.setSelectionRange(caret, caret);
    }
    onChange?.(event);
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const trimmed = trimTrailingDecimal(input.value, locale);
    if (trimmed !== input.value) input.value = trimmed;
    onBlur?.(event);
  }

  return (
    <Input
      type="text"
      inputMode={allowNegative ? 'text' : 'decimal'}
      autoComplete="off"
      {...props}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
