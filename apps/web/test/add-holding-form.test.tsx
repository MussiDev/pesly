// @vitest-environment happy-dom
import { INSTRUMENT_TYPES } from '@pesly/shared';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddHoldingForm } from '../src/features/investments/components/add-holding-form';
import { toHoldingFailure } from '../src/features/investments/holding-form-errors';
import { CATALOGS, renderApp, type TestLocale } from './support/render-app';
import { pickSegment, segmentOption, segmentValue } from './support/segmented';

const { es, en } = CATALOGS;

function renderForm(
  locale: TestLocale = 'es',
  props: Partial<Parameters<typeof AddHoldingForm>[0]> = {},
) {
  const onSubmit = vi.fn();
  renderApp(<AddHoldingForm language={locale} pending={false} onSubmit={onSubmit} {...props} />, {
    locale,
  });
  return { onSubmit, user: userEvent.setup() };
}

const labels = (locale: TestLocale) => CATALOGS[locale].investments.forms.addHolding;

describe('AddHoldingForm', () => {
  it('sends the scaled integers for AAPL, CEDEAR, 10, ARS, cost 150000.00 (AC-02)', async () => {
    const { onSubmit, user } = renderForm('en');
    const t = labels('en');

    await user.type(screen.getByLabelText(t.ticker), ' AAPL ');
    await user.type(screen.getByLabelText(t.instrumentName), 'Apple Inc.');
    await user.selectOptions(screen.getByLabelText(t.instrumentType), 'cedear');
    await user.type(screen.getByLabelText(t.quantity), '10');
    await pickSegment(t.currency, 'ARS');
    await user.type(screen.getByLabelText(t.totalCost), '150,000.00');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      ticker: 'AAPL',
      instrumentName: 'Apple Inc.',
      instrumentType: 'cedear',
      quantity: '1000000000',
      valuationCurrency: 'ARS',
      totalCost: '15000000',
    });
  });

  it('omits the total cost when it is left empty (AC-02)', async () => {
    const { onSubmit, user } = renderForm('es');
    const t = labels('es');

    await user.type(screen.getByLabelText(t.ticker), 'GGAL');
    await user.type(screen.getByLabelText(t.instrumentName), 'Galicia');
    await user.type(screen.getByLabelText(t.quantity), '2,5');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      ticker: 'GGAL',
      instrumentName: 'Galicia',
      instrumentType: 'stock',
      quantity: '250000000',
      valuationCurrency: 'ARS',
    });
  });

  it.each(['0', '-3'])(
    'shows a field error and sends nothing for quantity %s (AC-03)',
    async (typed) => {
      const { onSubmit, user } = renderForm('es');
      const t = labels('es');

      await user.type(screen.getByLabelText(t.ticker), 'AAPL');
      await user.type(screen.getByLabelText(t.instrumentName), 'Apple');
      await user.type(screen.getByLabelText(t.quantity), typed);
      await user.click(screen.getByRole('button', { name: t.submit }));

      const quantity = screen.getByLabelText(t.quantity);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(quantity.getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByText(es.investments.errors.notPositive)).toBeDefined();
    },
  );

  it('shows the ambiguity message for 1.000 in Spanish', async () => {
    const { onSubmit, user } = renderForm('es');
    const t = labels('es');

    await user.type(screen.getByLabelText(t.ticker), 'AAPL');
    await user.type(screen.getByLabelText(t.instrumentName), 'Apple');
    await user.type(screen.getByLabelText(t.quantity), '1.000');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(es.investments.errors.ambiguousSeparator)).toBeDefined();
  });

  it('validates the optional cost only when typed', async () => {
    const { onSubmit, user } = renderForm('en');
    const t = labels('en');

    await user.type(screen.getByLabelText(t.ticker), 'AAPL');
    await user.type(screen.getByLabelText(t.instrumentName), 'Apple');
    await user.type(screen.getByLabelText(t.quantity), '1');
    await user.type(screen.getByLabelText(t.totalCost), '0');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(t.totalCost).getAttribute('aria-invalid')).toBe('true');
  });

  it('rejects an empty ticker and an empty instrument name, focusing the first invalid field', async () => {
    const { onSubmit, user } = renderForm('es');
    const t = labels('es');

    await user.type(screen.getByLabelText(t.quantity), '1');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(es.investments.errors.tickerInvalid)).toBeDefined();
    expect(screen.getByText(es.investments.errors.instrumentNameRequired)).toBeDefined();
    expect(document.activeElement).toBe(screen.getByLabelText(t.ticker));
  });

  it('rejects a ticker with characters outside the shared pattern', async () => {
    const { onSubmit, user } = renderForm('es');
    const t = labels('es');

    await user.type(screen.getByLabelText(t.ticker), 'AA PL');
    await user.type(screen.getByLabelText(t.instrumentName), 'Apple');
    await user.type(screen.getByLabelText(t.quantity), '1');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(es.investments.errors.tickerInvalid)).toBeDefined();
  });

  it('offers exactly the seven instrument types (AC-04)', () => {
    renderForm('es');

    const select = screen.getByLabelText(labels('es').instrumentType);
    const options = within(select).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('value'))).toEqual([...INSTRUMENT_TYPES]);
    expect(options).toHaveLength(7);
    expect(options.map((option) => option.textContent)).toEqual(
      INSTRUMENT_TYPES.map((type) => es.investments.instrumentTypes[type]),
    );
  });

  it('forces USD and makes ARS unavailable when crypto is chosen (AC-18)', async () => {
    const { onSubmit, user } = renderForm('es');
    const t = labels('es');
    await user.selectOptions(screen.getByLabelText(t.instrumentType), 'crypto');

    expect(segmentValue(t.currency)).toBe('USD');
    expect(segmentOption(t.currency, 'ARS').disabled).toBe(true);

    await user.type(screen.getByLabelText(t.ticker), 'BTC');
    await user.type(screen.getByLabelText(t.instrumentName), 'Bitcoin');
    await user.type(screen.getByLabelText(t.quantity), '0,5');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ instrumentType: 'crypto', valuationCurrency: 'USD' }),
    );
  });

  it('re-enables ARS when the type is no longer crypto (AC-18)', async () => {
    const { user } = renderForm('es');
    const t = labels('es');

    await user.selectOptions(screen.getByLabelText(t.instrumentType), 'crypto');
    await user.selectOptions(screen.getByLabelText(t.instrumentType), 'stock');

    expect(segmentOption(t.currency, 'ARS').disabled).toBe(false);
  });

  it('shows the currency mismatch message for an API 400 on valuationCurrency (AC-24)', () => {
    renderForm('es', { errors: { fields: { valuationCurrency: 'currencyMismatch' } } });

    const currency = screen.getByLabelText(labels('es').currency);
    expect(currency.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(es.investments.errors.currencyMismatch)).toBeDefined();
    expect(document.activeElement).toBe(currency);
  });

  it('shows a form-level error in English and keeps submit disabled while pending', () => {
    renderForm('en', { pending: true, errors: { form: 'network' } });

    expect(screen.getByRole('alert').textContent).toContain(en.investments.errors.network);
    expect(
      screen
        .getByRole('button', { name: en.investments.forms.addHolding.pending })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('shows the mismatch text for an API 400 on body.valuationCurrency, joined through toHoldingFailure (AC-24)', () => {
    const errors = toHoldingFailure(
      {
        ok: false,
        code: 'VALIDATION_FAILED',
        messageKey: 'validationFailed',
        fields: ['body.valuationCurrency'],
      },
      'add',
    );
    renderForm('es', { errors });

    expect(screen.getByText(es.investments.errors.currencyMismatch)).toBeDefined();
    expect(screen.getByLabelText(labels('es').currency).getAttribute('aria-invalid')).toBe('true');
  });

  it('does not call onSubmit when submitted while pending', () => {
    const { onSubmit } = renderForm('es', { pending: true });
    const t = labels('es');

    fireEvent.change(screen.getByLabelText(t.ticker), { target: { value: 'AAPL' } });
    fireEvent.change(screen.getByLabelText(t.instrumentName), { target: { value: 'Apple' } });
    fireEvent.change(screen.getByLabelText(t.quantity), { target: { value: '1' } });
    fireEvent.submit(screen.getByLabelText(t.ticker).closest('form') as HTMLFormElement);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  async function fillValid(user: ReturnType<typeof userEvent.setup>, locale: TestLocale) {
    const t = labels(locale);
    await user.type(screen.getByLabelText(t.ticker), 'AAPL');
    await user.type(screen.getByLabelText(t.instrumentName), 'Apple');
    await user.type(screen.getByLabelText(t.quantity), '1');
  }

  it('shows a distinct too-long message for an instrument name over 100 characters', async () => {
    const { onSubmit, user } = renderForm('es');
    const t = labels('es');

    await user.type(screen.getByLabelText(t.ticker), 'AAPL');
    await user.click(screen.getByLabelText(t.instrumentName));
    await user.paste('a'.repeat(101));
    await user.type(screen.getByLabelText(t.quantity), '1');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(es.investments.errors.instrumentNameTooLong)).toBeDefined();
    expect(screen.queryByText(es.investments.errors.instrumentNameRequired)).toBeNull();
  });

  it('shows the ticker message for a ticker over 20 characters', async () => {
    const { onSubmit, user } = renderForm('es');
    const t = labels('es');

    await user.type(screen.getByLabelText(t.ticker), 'A'.repeat(21));
    await user.type(screen.getByLabelText(t.instrumentName), 'Apple');
    await user.type(screen.getByLabelText(t.quantity), '1');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(es.investments.errors.tickerInvalid)).toBeDefined();
  });

  it('shows the decimals message for a quantity with more than 8 decimals', async () => {
    const { onSubmit, user } = renderForm('en');
    const t = labels('en');

    await fillValid(user, 'en');
    await user.clear(screen.getByLabelText(t.quantity));
    await user.type(screen.getByLabelText(t.quantity), '1.123456789');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(en.investments.errors.tooManyDecimals)).toBeDefined();
  });

  it('shows the range message for a cost above the maximum', async () => {
    const { onSubmit, user } = renderForm('en');
    const t = labels('en');

    await fillValid(user, 'en');
    await user.type(screen.getByLabelText(t.totalCost), '10000000000000.01');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(en.investments.errors.amountInvalid)).toBeDefined();
  });

  it('focuses the first invalid field when several are invalid', async () => {
    const { user } = renderForm('es');
    const t = labels('es');

    await user.type(screen.getByLabelText(t.quantity), '0');
    await user.type(screen.getByLabelText(t.totalCost), '0');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(document.activeElement).toBe(screen.getByLabelText(t.ticker));
  });
});
