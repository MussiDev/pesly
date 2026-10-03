// @vitest-environment happy-dom
import { parseAmountInput } from '@pesly/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { MoneyInput } from '@/components/ui/money-input';
import { formatMoneyInput, trimTrailingDecimal } from '@/lib/money-input';

const es = { locale: 'es' };
const en = { locale: 'en' };

function typed(raw: string, options: { locale: string; allowNegative?: boolean }) {
  return formatMoneyInput(raw, raw.length, options).text;
}

describe('formatMoneyInput', () => {
  it('adds the thousands separator of the locale while digits are typed', () => {
    expect(typed('3000', es)).toBe('3.000');
    expect(typed('1250000', es)).toBe('1.250.000');
    expect(typed('3000', en)).toBe('3,000');
  });

  it('keeps up to two decimals after the locale decimal separator', () => {
    expect(typed('3.000,5', es)).toBe('3.000,5');
    expect(typed('3.000,567', es)).toBe('3.000,56');
    expect(typed('3,000.5', en)).toBe('3,000.5');
  });

  it('gives the same result when the separators are typed or pasted in full', () => {
    expect(typed('1.500,00', es)).toBe('1.500,00');
    expect(typed('1.500,00', es)).toBe(typed('1500,00', es));
    expect(typed('1,500.00', en)).toBe('1,500.00');
  });

  it('drops the other locale separator instead of reading it as a decimal', () => {
    expect(typed('3.', es)).toBe('3');
    expect(typed('3,', en)).toBe('3');
    expect(typed('1.2345', es)).toBe('12.345');
    expect(typed('1,2.5', es)).toBe('1,25');
  });

  it('strips leading zeros, shows a lone decimal mark as 0, and never exceeds the digit cap', () => {
    expect(typed('007', es)).toBe('7');
    expect(typed(',', es)).toBe('0,');
    expect(typed('1'.repeat(20), es).replace(/\./g, '')).toHaveLength(15);
  });

  it('drops letters and symbols, and the sign unless negatives are allowed', () => {
    expect(typed('12abc', es)).toBe('12');
    expect(typed('-50', es)).toBe('50');
    expect(typed('-5000', { ...es, allowNegative: true })).toBe('-5.000');
    expect(typed('5-0', { ...es, allowNegative: true })).toBe('50');
    expect(typed('abc', es)).toBe('');
  });

  it('keeps the caret after the same digit when editing in the middle', () => {
    // "1.234" with a digit typed after the "1": raw "19.234", caret 2.
    const result = formatMoneyInput('19.234', 2, es);
    expect(result.text).toBe('19.234');
    expect(result.caret).toBe(2);
    // Typing at the start of "999" -> "1999" -> "1.999": caret after the first digit.
    const start = formatMoneyInput('1999', 1, es);
    expect(start.text).toBe('1.999');
    expect(start.caret).toBe(1);
  });

  it('produces text that parseAmountInput accepts, with the same value', () => {
    expect(parseAmountInput(typed('3000', es), 'es')).toBe(300000n);
    expect(parseAmountInput(typed('1250000,5', es), 'es')).toBe(125000050n);
    expect(parseAmountInput(typed('3000.5', en), 'en')).toBe(300050n);
  });
});

describe('trimTrailingDecimal', () => {
  it('removes a decimal mark with no digits after it', () => {
    expect(trimTrailingDecimal('3,', 'es')).toBe('3');
    expect(trimTrailingDecimal('3.', 'en')).toBe('3');
    expect(trimTrailingDecimal('3,5', 'es')).toBe('3,5');
  });
});

describe('MoneyInput', () => {
  afterEach(cleanup);

  function renderInput(locale: 'es' | 'en', props: { allowNegative?: boolean } = {}) {
    render(
      <NextIntlClientProvider locale={locale} messages={{}}>
        <MoneyInput aria-label="amount" name="amount" {...props} />
      </NextIntlClientProvider>,
    );
    return screen.getByLabelText<HTMLInputElement>('amount');
  }

  it('formats the value on change and keeps it as plain text', () => {
    const input = renderInput('es');
    fireEvent.change(input, { target: { value: '3000' } });
    expect(input.value).toBe('3.000');
    fireEvent.change(input, { target: { value: '3.0005' } });
    expect(input.value).toBe('30.005');
  });

  it('removes a dangling decimal mark on blur', () => {
    const input = renderInput('es');
    fireEvent.change(input, { target: { value: '3000,' } });
    expect(input.value).toBe('3.000,');
    fireEvent.blur(input);
    expect(input.value).toBe('3.000');
  });

  it('uses the English separators in English', () => {
    const input = renderInput('en');
    fireEvent.change(input, { target: { value: '1234567' } });
    expect(input.value).toBe('1,234,567');
  });

  it('allows a leading minus only when negatives are allowed', () => {
    const plain = renderInput('es');
    fireEvent.change(plain, { target: { value: '-50' } });
    expect(plain.value).toBe('50');
  });
});
