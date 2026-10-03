// @vitest-environment happy-dom
import type { HoldingResponse } from '@pesly/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HoldingRow } from '../src/features/investments/components/holding-row';
import { formatDateTime } from '../src/lib/format-amount';
import { HOLDING, PRICED_AT } from './support/holding-fixture';
import { CATALOGS, renderApp, type TestLocale } from './support/render-app';

const { es, en } = CATALOGS;

function renderRow(holding: Partial<HoldingResponse> = {}, locale: TestLocale = 'en') {
  const handlers = { onEdit: vi.fn(), onSetPrice: vi.fn(), onDelete: vi.fn() };
  renderApp(
    <ul>
      <HoldingRow
        holding={{ ...HOLDING, ...holding }}
        language={locale}
        timeZone="UTC"
        {...handlers}
      />
    </ul>,
    { locale },
  );
  return handlers;
}

describe('HoldingRow', () => {
  it('AC-10: shows the value of a priced holding with its currency', () => {
    renderRow();

    expect(screen.getByText('AAPL')).toBeTruthy();
    expect(screen.getByText('Apple Inc.')).toBeTruthy();
    expect(screen.getByText(en.investments.instrumentTypes.cedear)).toBeTruthy();
    expect(screen.getByText('185,000.00 ARS')).toBeTruthy();
  });

  it('AC-10: formats the value with Spanish separators in Spanish', () => {
    renderRow({}, 'es');

    expect(screen.getByText('185.000,00 ARS')).toBeTruthy();
    expect(screen.getByText(es.investments.instrumentTypes.cedear)).toBeTruthy();
  });

  it('FEAT-004: draws the holding as a list row with quantity, value and gain', () => {
    const { container } = renderApp(
      <ul>
        <HoldingRow holding={HOLDING} language="en" timeZone="UTC" />
      </ul>,
      { locale: 'en' },
    );

    const row = container.querySelector('li > [data-slot="list-row"]');
    expect(row).not.toBeNull();
    const text = (row?.textContent ?? '').replace(/\s/g, ' ');
    expect(text).toContain('AAPL');
    expect(text).toContain('Quantity: 10');
    expect(text).toContain('185,000.00 ARS');
    expect(text).toContain('Gain +35,000.00 ARS (+23.33%)');
  });

  it('class-string contract (AC-11): the gain keeps its label and sign and takes the income token', () => {
    renderRow();

    const gain = screen.getByText('Gain +35,000.00 ARS (+23.33%)');
    expect(gain.className).toContain('text-income');
    expect(gain.className).not.toContain('text-destructive');
  });

  it('AC-11: shows the gain in Spanish', () => {
    renderRow({}, 'es');

    expect(screen.getByText('Ganancia +35.000,00 ARS (+23,33%)')).toBeTruthy();
  });

  it('class-string contract (AC-11): the loss keeps its label and minus sign and takes the destructive token', () => {
    renderRow({ gain: { amount: '-1000000', basisPoints: '-500' } });

    const loss = screen.getByText('Loss -10,000.00 ARS (-5.00%)');
    expect(loss.className).toContain('text-destructive');
    expect(screen.queryByText(/^Gain/)).toBeNull();
  });

  it('AC-12: shows no gain when there is no total cost', () => {
    renderRow({ totalCost: null, gain: null });

    expect(screen.getByText('185,000.00 ARS')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
    expect(screen.queryByText(/^Gain/)).toBeNull();
  });

  it.each([
    ['en', en.investments.holding.priceNeeded],
    ['es', es.investments.holding.priceNeeded],
  ] as const)('AC-19: shows "price needed" and no value or gain in %s', (locale, text) => {
    renderRow(
      {
        unitPrice: null,
        priceSource: null,
        pricedAt: null,
        value: null,
        gain: null,
      },
      locale,
    );

    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(/ARS/)).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('AC-09: opening the details shows unit price, source and date and time', async () => {
    const user = userEvent.setup();
    renderRow();

    const toggle = screen.getByRole('button', { name: 'Show details for AAPL' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBeNull();
    expect(screen.queryByText(en.investments.priceSources.manual)).toBeNull();

    await user.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const panelId = toggle.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId ?? '')).not.toBeNull();
    expect(screen.getByText(en.investments.priceSources.manual)).toBeTruthy();
    expect(screen.getByText(formatDateTime(PRICED_AT, 'UTC', 'en'))).toBeTruthy();
    expect(screen.getByText('18,500.00 ARS')).toBeTruthy();
  });

  it('AC-09: collapsing the details again hides them', async () => {
    const user = userEvent.setup();
    renderRow();

    await user.click(screen.getByRole('button', { name: 'Show details for AAPL' }));
    const toggle = screen.getByRole('button', { name: 'Hide details for AAPL' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await user.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBeNull();
    expect(screen.queryByText(en.investments.priceSources.manual)).toBeNull();
  });

  it('AC-19: an opened holding without price says there is no price yet', async () => {
    const user = userEvent.setup();
    renderRow({ unitPrice: null, priceSource: null, pricedAt: null, value: null, gain: null });

    await user.click(screen.getByRole('button', { name: 'Show details for AAPL' }));

    expect(screen.getByText(en.investments.holding.noPrice)).toBeTruthy();
    expect(screen.queryByText(en.investments.holding.unitPrice)).toBeNull();
  });

  it('AC-09: the actions name the ticker and pass the holding id', async () => {
    const user = userEvent.setup();
    const handlers = renderRow();

    await user.click(screen.getByRole('button', { name: 'Show details for AAPL' }));
    await user.click(screen.getByRole('button', { name: 'Edit AAPL' }));
    await user.click(screen.getByRole('button', { name: 'Set price for AAPL' }));
    await user.click(screen.getByRole('button', { name: 'Delete AAPL' }));

    expect(handlers.onEdit).toHaveBeenCalledWith(HOLDING.id);
    expect(handlers.onSetPrice).toHaveBeenCalledWith(HOLDING.id);
    expect(handlers.onDelete).toHaveBeenCalledWith(HOLDING.id);
  });

  it('only renders the actions whose callback is provided', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderApp(
      <ul>
        <HoldingRow holding={HOLDING} language="en" timeZone="UTC" onEdit={onEdit} />
      </ul>,
      { locale: 'en' },
    );

    await user.click(screen.getByRole('button', { name: 'Show details for AAPL' }));

    expect(screen.getByRole('button', { name: 'Edit AAPL' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set price for AAPL' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete AAPL' })).toBeNull();
  });

  it('AC-14: a stale price shows its date next to the holding', () => {
    renderRow({ priceStale: true });

    const date = formatDateTime(PRICED_AT, 'UTC', 'en');
    expect(screen.getByText(`Price from ${date}`)).toBeTruthy();
  });

  it('AC-14: a stale price shows its date and time in Spanish', () => {
    renderRow({ priceStale: true }, 'es');

    const date = formatDateTime(PRICED_AT, 'UTC', 'es');
    expect(screen.getByText(`Precio al ${date}`)).toBeTruthy();
  });

  it('AC-14: a fresh price shows no stale label', () => {
    renderRow({ priceStale: false });

    expect(screen.queryByText(/Price from/)).toBeNull();
  });

  it('renders the raw keys of an unknown instrument type and price source', async () => {
    const user = userEvent.setup();
    renderRow({
      instrumentType: 'future_thing' as HoldingResponse['instrumentType'],
      priceSource: 'oracle' as HoldingResponse['priceSource'],
    });

    expect(screen.getByText('future_thing')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show details for AAPL' }));
    expect(screen.getByText('oracle')).toBeTruthy();
  });
});
