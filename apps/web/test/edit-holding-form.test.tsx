// @vitest-environment happy-dom
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditHoldingForm } from '../src/features/investments/components/edit-holding-form';
import { CATALOGS, renderApp, type TestLocale } from './support/render-app';
import { HOLDING } from './support/holding-fixture';
import { pickSegment, segmentOption, segmentValue } from './support/segmented';

const { es, en } = CATALOGS;

function renderForm(
  locale: TestLocale = 'es',
  props: Partial<Parameters<typeof EditHoldingForm>[0]> = {},
) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  renderApp(
    <EditHoldingForm
      holding={HOLDING}
      language={locale}
      pending={false}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...props}
    />,
    { locale },
  );
  return { onSubmit, onCancel, user: userEvent.setup() };
}

const labels = (locale: TestLocale) => CATALOGS[locale].investments.forms.editHolding;

describe('EditHoldingForm', () => {
  it('starts with the saved values, without grouping separators', () => {
    renderForm('es');
    const t = labels('es');

    expect(screen.getByLabelText<HTMLInputElement>(t.quantity).value).toBe('10');
    expect(screen.getByLabelText<HTMLInputElement>(t.totalCost).value).toBe('150000');
    expect(segmentValue(t.currency)).toBe('ARS');
  });

  it('sends only the quantity when only the quantity changes to 15 (AC-05)', async () => {
    const { onSubmit, user } = renderForm('en');
    const t = labels('en');

    await user.clear(screen.getByLabelText(t.quantity));
    await user.type(screen.getByLabelText(t.quantity), '15');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ quantity: '1500000000' });
  });

  it('sends the total cost together with a changed currency and shows the notice (AC-22)', async () => {
    const { onSubmit, user } = renderForm('en');
    const t = labels('en');

    expect(screen.queryByText(t.currencyChangeNotice)).toBeNull();
    await pickSegment(t.currency, 'USD');
    expect(screen.getByText(t.currencyChangeNotice)).toBeDefined();

    await user.clear(screen.getByLabelText(t.totalCost));
    await user.type(screen.getByLabelText(t.totalCost), '1200.50');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      valuationCurrency: 'USD',
      totalCost: '120050',
    });
  });

  it('sends an explicit null cost when the currency changes and the cost is cleared (AC-22)', async () => {
    const { onSubmit, user } = renderForm('es');
    const t = labels('es');

    await pickSegment(t.currency, 'USD');
    await user.clear(screen.getByLabelText(t.totalCost));
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ valuationCurrency: 'USD', totalCost: null });
  });

  it('empties the cost input when the currency changes, so the old amount is not resent (AC-22)', async () => {
    renderForm('es');
    const t = labels('es');

    expect(screen.getByLabelText<HTMLInputElement>(t.totalCost).value).toBe('150000');
    await pickSegment(t.currency, 'USD');

    expect(screen.getByLabelText<HTMLInputElement>(t.totalCost).value).toBe('');
  });

  it('sends totalCost null with the new currency when the cost is not typed again (AC-22)', async () => {
    const { onSubmit, user } = renderForm('es');
    const t = labels('es');

    await pickSegment(t.currency, 'USD');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ valuationCurrency: 'USD', totalCost: null });
  });

  it('sends a newly typed cost with the new currency (AC-22)', async () => {
    const { onSubmit, user } = renderForm('es');
    const t = labels('es');

    await pickSegment(t.currency, 'USD');
    await user.type(screen.getByLabelText(t.totalCost), '1200,5');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      valuationCurrency: 'USD',
      totalCost: '120050',
    });
  });

  it('restores the original cost when the currency goes back, and sends nothing for it (AC-22)', async () => {
    const { onSubmit, onCancel, user } = renderForm('es');
    const t = labels('es');

    await pickSegment(t.currency, 'USD');
    await pickSegment(t.currency, 'ARS');

    expect(screen.getByLabelText<HTMLInputElement>(t.totalCost).value).toBe('150000');
    await user.click(screen.getByRole('button', { name: t.submit }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('restores the original cost and sends only the quantity after a currency round trip', async () => {
    const { onSubmit, user } = renderForm('en');
    const t = labels('en');

    await pickSegment(t.currency, 'USD');
    await pickSegment(t.currency, 'ARS');
    await user.clear(screen.getByLabelText(t.quantity));
    await user.type(screen.getByLabelText(t.quantity), '15');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ quantity: '1500000000' });
  });

  it.each([
    ['en', /enter the total cost again/i],
    ['es', /de nuevo el costo/i],
  ] as const)('tells the user to enter the cost again in %s (AC-22)', async (locale, pattern) => {
    renderForm(locale);
    const t = labels(locale);

    await pickSegment(t.currency, 'USD');

    expect(screen.getByText(t.currencyChangeNotice).textContent).toMatch(pattern);
  });

  it('sends a null cost when a saved cost is cleared without a currency change', async () => {
    const { onSubmit, user } = renderForm('es');
    const t = labels('es');

    await user.clear(screen.getByLabelText(t.totalCost));
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ totalCost: null });
  });

  it('shows a field error and sends nothing for a quantity of 0', async () => {
    const { onSubmit, user } = renderForm('es');
    const t = labels('es');

    await user.clear(screen.getByLabelText(t.quantity));
    await user.type(screen.getByLabelText(t.quantity), '0');
    await user.click(screen.getByRole('button', { name: t.submit }));

    const quantity = screen.getByLabelText(t.quantity);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(quantity.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(es.investments.errors.notPositive)).toBeDefined();
    expect(document.activeElement).toBe(quantity);
  });

  it('does not offer ARS for a crypto holding', () => {
    renderForm('es', {
      holding: { ...HOLDING, instrumentType: 'crypto', valuationCurrency: 'USD' },
    });

    expect(segmentOption(labels('es').currency, 'ARS').disabled).toBe(true);
  });

  it('cancels instead of sending when nothing changed', async () => {
    const { onSubmit, onCancel, user } = renderForm('es');

    await user.click(screen.getByRole('button', { name: labels('es').submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows the API cost-required error next to the cost field', () => {
    renderForm('es', { errors: { fields: { totalCost: 'costRequired' } } });

    const cost = screen.getByLabelText(labels('es').totalCost);
    expect(cost.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(es.investments.errors.costRequired)).toBeDefined();
  });

  it('keeps submit disabled while pending, in English', () => {
    renderForm('en', { pending: true });

    expect(
      screen
        .getByRole('button', { name: en.investments.forms.editHolding.pending })
        .hasAttribute('disabled'),
    ).toBe(true);
  });

  it('keeps the status container mounted so the currency notice is announced', async () => {
    renderForm('en');
    const t = labels('en');

    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');

    await pickSegment(t.currency, 'USD');

    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toContain(t.currencyChangeNotice);

    await pickSegment(t.currency, 'ARS');
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('');
  });

  it('focuses the first invalid field when several are invalid', async () => {
    const { onSubmit, user } = renderForm('es');
    const t = labels('es');

    await user.clear(screen.getByLabelText(t.quantity));
    await user.type(screen.getByLabelText(t.quantity), '0');
    await user.clear(screen.getByLabelText(t.totalCost));
    await user.type(screen.getByLabelText(t.totalCost), '0');
    await user.click(screen.getByRole('button', { name: t.submit }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(t.totalCost).getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(screen.getByLabelText(t.quantity));
  });

  it('focuses the first field with an API error', () => {
    renderForm('es', {
      errors: { fields: { totalCost: 'costRequired', valuationCurrency: 'cryptoOnlyUsd' } },
    });

    expect(document.activeElement).toBe(screen.getByLabelText(labels('es').currency));
  });

  it('does not call onSubmit when submitted while pending', () => {
    const { onSubmit, onCancel } = renderForm('es', { pending: true });
    const t = labels('es');

    fireEvent.change(screen.getByLabelText(t.quantity), { target: { value: '15' } });
    fireEvent.submit(screen.getByLabelText(t.quantity).closest('form') as HTMLFormElement);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
