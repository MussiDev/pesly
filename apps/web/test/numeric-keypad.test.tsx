// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { MovementForm } from '../src/features/movements/components/movement-form';
import { applyKey } from '../src/features/movements/keypad-input';
import { typeButton } from './support/type-button';

afterEach(cleanup);

describe('applyKey', () => {
  it('appends digits and one decimal separator, and starts the decimals from 0', () => {
    expect(applyKey('', '5', ',')).toBe('5');
    expect(applyKey('12', '3', ',')).toBe('123');
    expect(applyKey('', ',', ',')).toBe('0,');
    expect(applyKey('12', ',', ',')).toBe('12,');
    expect(applyKey('12,5', ',', ',')).toBe('12,5');
    expect(applyKey('12.5', '.', '.')).toBe('12.5');
  });

  it('deletes the last digit, together with a thousands separator left at the end', () => {
    expect(applyKey('1.234', 'backspace', ',')).toBe('1.23');
    expect(applyKey('1.2', 'backspace', ',')).toBe('1');
    expect(applyKey('1,234', 'backspace', '.')).toBe('1,23');
    expect(applyKey('', 'backspace', ',')).toBe('');
  });
});

function renderForm(locale: 'es' | 'en' = 'es') {
  const catalog = locale === 'en' ? en : es;
  render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={catalog}>
      <MovementForm
        accounts={[
          { id: 'a1', name: 'Caja', currency: 'ARS' },
          { id: 'a2', name: 'Dolares', currency: 'USD' },
        ]}
        categories={[{ id: 'c1', kind: 'expense', label: 'Comida' }]}
        defaultOccurredAt="2026-10-02T12:30"
        defaultRate="1250,5"
        rateType="blue"
        rateAgeHours={undefined}
        pending={false}
        errors={{}}
        onSubmit={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  return catalog;
}

const key = (name: string) => screen.getByRole('button', { name });

describe('the on-screen keypad of the movement form', () => {
  it('types the amount, formatting the thousands, and deletes digits', async () => {
    const catalog = renderForm();
    const user = userEvent.setup();
    const amount = screen.getByLabelText<HTMLInputElement>(catalog.movements.fields.amount);

    for (const digit of ['1', '2', '3', '4']) await user.click(key(digit));
    expect(amount.value).toBe('1.234');
    await user.click(key(catalog.movements.keypad.decimal));
    await user.click(key('5'));
    expect(amount.value).toBe('1.234,5');
    await user.click(key(catalog.movements.keypad.backspace));
    await user.click(key(catalog.movements.keypad.backspace));
    expect(amount.value).toBe('1.234');
  });

  it('uses the decimal point in English', async () => {
    const catalog = renderForm('en');
    const user = userEvent.setup();

    await user.click(key('9'));
    await user.click(key(catalog.movements.keypad.decimal));
    await user.click(key('5'));
    expect(screen.getByLabelText<HTMLInputElement>(catalog.movements.fields.amount).value).toBe(
      '9.5',
    );
  });

  it('types into the amount that was touched last on an exchange', async () => {
    const catalog = renderForm();
    const user = userEvent.setup();
    await user.click(typeButton('exchange'));

    await user.click(screen.getByLabelText(catalog.movements.fields.amountIn));
    await user.click(key('7'));
    expect(screen.getByLabelText<HTMLInputElement>(catalog.movements.fields.amountIn).value).toBe(
      '7',
    );
    expect(screen.getByLabelText<HTMLInputElement>(catalog.movements.fields.amountOut).value).toBe(
      '',
    );
  });

  it('lists the type buttons in one group and marks the chosen one', async () => {
    const catalog = renderForm();
    await userEvent.setup().click(typeButton('income'));

    const group = screen.getByRole('group', { name: catalog.movements.fields.type });
    expect(within(group).getAllByRole('button')).toHaveLength(4);
    expect(typeButton('income').getAttribute('aria-pressed')).toBe('true');
    expect(typeButton('expense').getAttribute('aria-pressed')).toBe('false');
  });
});
