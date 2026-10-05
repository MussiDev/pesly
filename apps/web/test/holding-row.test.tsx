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

describe('HoldingRow logos and gain markers (AC-24, AC-25, AC-33)', () => {
  it('shows the catalog logo of the ticker as its leading avatar', () => {
    const { container } = renderApp(
      <ul>
        <HoldingRow holding={HOLDING} language="en" timeZone="UTC" />
      </ul>,
      { locale: 'en' },
    );

    expect(container.querySelector('li img')?.getAttribute('src')).toBe('/logos/apple.svg');
  });

  it('error: a ticker with no logo shows an avatar with its first two characters', () => {
    const { container } = renderApp(
      <ul>
        <HoldingRow
          holding={{ ...HOLDING, ticker: 'GGAL', instrumentName: 'Grupo Galicia' }}
          language="en"
          timeZone="UTC"
        />
      </ul>,
      { locale: 'en' },
    );

    expect(container.querySelector('li img')).toBeNull();
    expect(container.querySelector('[data-slot="avatar"]')?.textContent).toBe('GG');
  });

  it('marks a gain with an up arrow and a plus sign, not by colour alone', () => {
    const { container } = renderApp(
      <ul>
        <HoldingRow holding={HOLDING} language="en" timeZone="UTC" />
      </ul>,
      { locale: 'en' },
    );

    expect(container.querySelector('[data-gain="up"]')).not.toBeNull();
    expect(container.querySelector('[data-gain="down"]')).toBeNull();
    expect(container.textContent.replace(/\s/g, ' ')).toContain('Gain +35,000.00 ARS');
  });

  it('marks a loss with a down arrow and a minus sign', () => {
    const { container } = renderApp(
      <ul>
        <HoldingRow
          holding={{ ...HOLDING, gain: { amount: '-500000', basisPoints: '-333' } }}
          language="en"
          timeZone="UTC"
        />
      </ul>,
      { locale: 'en' },
    );

    expect(container.querySelector('[data-gain="down"]')).not.toBeNull();
    expect(container.querySelector('[data-gain="up"]')).toBeNull();
    expect(container.textContent.replace(/\s/g, ' ')).toContain('Loss -5,000.00 ARS');
  });

  it('error: a holding without a gain shows no arrow', () => {
    const { container } = renderApp(
      <ul>
        <HoldingRow holding={{ ...HOLDING, gain: null }} language="en" timeZone="UTC" />
      </ul>,
      { locale: 'en' },
    );

    expect(container.querySelector('[data-gain]')).toBeNull();
  });
});

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

describe('HoldingRow manual price warning (DISC-001-07b)', () => {
  const MARKET_AT = '2026-09-30T23:30:00.000Z';
  const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
  const WARNED: Partial<HoldingResponse> = {
    marketUnitPrice: '2050000',
    marketPricedAt: MARKET_AT,
    marketPriceDiffers: true,
    marketPriceRecent: true,
  };

  function renderWarned(
    holding: Partial<HoldingResponse>,
    options: { locale?: TestLocale; timeZone?: string; callback?: boolean } = {},
  ) {
    const { locale = 'en', timeZone = 'UTC', callback = true } = options;
    const onUseAutomaticPrice = vi.fn();
    renderApp(
      <ul>
        <HoldingRow
          holding={{ ...HOLDING, ...holding }}
          language={locale}
          timeZone={timeZone}
          onUseAutomaticPrice={callback ? onUseAutomaticPrice : undefined}
        />
      </ul>,
      { locale },
    );
    return onUseAutomaticPrice;
  }

  it('AC-07: a recent market price says "today" with the price, without opening the details', () => {
    renderWarned(WARNED);

    expect(
      screen.getByText(
        "This price is manual, but the market price changed: today it's worth 20,500.00 ARS",
      ),
    ).toBeTruthy();
  });

  it('AC-08: says "hoy vale" with Spanish separators in Spanish', () => {
    renderWarned(WARNED, { locale: 'es' });

    expect(
      screen.getByText('Este precio es manual, pero el de mercado cambió: hoy vale 20.500,00 ARS'),
    ).toBeTruthy();
  });

  it('AC-08: formats a USD market price with its currency', () => {
    renderWarned({ ...WARNED, valuationCurrency: 'USD', marketUnitPrice: '123456' });

    expect(screen.getByText(/today it's worth 1,234.56 USD$/)).toBeTruthy();
  });

  it('AC-11: an older market price says "on <date>" in the user time zone and never "today"', () => {
    renderWarned({ ...WARNED, marketPriceRecent: false }, { timeZone: BUENOS_AIRES });

    const date = formatDateTime(MARKET_AT, BUENOS_AIRES, 'en');
    expect(date).not.toBe(formatDateTime(MARKET_AT, 'UTC', 'en'));
    expect(
      screen.getByText(
        `This price is manual, but the market price changed: on ${date} it was worth 20,500.00 ARS`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/today/)).toBeNull();
  });

  it('AC-11: the older wording in Spanish uses "al <fecha> valía"', () => {
    renderWarned({ ...WARNED, marketPriceRecent: false }, { locale: 'es', timeZone: BUENOS_AIRES });

    const date = formatDateTime(MARKET_AT, BUENOS_AIRES, 'es');
    expect(
      screen.getByText(
        `Este precio es manual, pero el de mercado cambió: al ${date} valía 20.500,00 ARS`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/hoy/)).toBeNull();
  });

  it('AC-16: a 30 day old market price still warns with its date, not "today"', () => {
    const old = '2026-09-02T12:00:00.000Z';
    renderWarned({ ...WARNED, marketPricedAt: old, marketPriceRecent: false });

    const date = formatDateTime(old, 'UTC', 'en');
    expect(screen.getByText(new RegExp(`on ${date} it was worth 20,500.00 ARS$`))).toBeTruthy();
    expect(screen.queryByText(/today/)).toBeNull();
  });

  it('AC-09: shows no warning and no button when the market price does not differ', () => {
    renderWarned({ ...WARNED, marketPriceDiffers: false });

    expect(screen.queryByText(/market price changed/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Use automatic price/ })).toBeNull();
  });

  it('AC-10: shows no warning and no button for an automatic price', () => {
    renderWarned({ priceSource: 'automatic', marketUnitPrice: null, marketPriceDiffers: false });

    expect(screen.queryByText(/market price changed/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Use automatic price/ })).toBeNull();
  });

  it('shows no warning when the flag is set but the market price is missing', () => {
    renderWarned({ ...WARNED, marketUnitPrice: null });

    expect(screen.queryByText(/market price changed/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Use automatic price/ })).toBeNull();
  });

  it('AC-12: the button has the ticker in its name and calls the callback with the holding id', async () => {
    const onUseAutomaticPrice = renderWarned(WARNED);

    const button = screen.getByRole('button', { name: 'Use automatic price for AAPL' });
    expect(button.textContent).toContain('Use automatic price');
    await userEvent.setup().click(button);

    expect(onUseAutomaticPrice).toHaveBeenCalledTimes(1);
    expect(onUseAutomaticPrice).toHaveBeenCalledWith(HOLDING.id);
  });

  it('the button name is in Spanish in Spanish', () => {
    renderWarned(WARNED, { locale: 'es' });

    expect(screen.getByRole('button', { name: 'Usar precio automático de AAPL' })).toBeTruthy();
    expect(screen.getByText('Usar precio automático')).toBeTruthy();
  });

  it('shows the warning but no button without the callback', () => {
    renderWarned(WARNED, { callback: false });

    expect(screen.getByText(/market price changed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Use automatic price/ })).toBeNull();
  });

  it('disables the button while a change is pending', () => {
    const onUseAutomaticPrice = vi.fn();
    renderApp(
      <ul>
        <HoldingRow
          holding={{ ...HOLDING, ...WARNED }}
          language="en"
          timeZone="UTC"
          pending
          onUseAutomaticPrice={onUseAutomaticPrice}
        />
      </ul>,
      { locale: 'en' },
    );

    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Use automatic price for AAPL',
    });
    expect(button.disabled).toBe(true);
  });

  it('keeps the button enabled when nothing is pending', () => {
    renderWarned(WARNED);

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Use automatic price for AAPL' })
        .disabled,
    ).toBe(false);
  });
});
