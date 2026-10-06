// @vitest-environment happy-dom
import type { HoldingResponse, PortfolioResponse } from '@pesly/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PortfolioCard } from '../src/features/investments/components/portfolio-card';
import { formatPercentage } from '../src/lib/format-amount';
import { HOLDING } from './support/holding-fixture';
import { CATALOGS, renderApp, type TestLocale } from './support/render-app';

const { es, en } = CATALOGS;

const PORTFOLIO: PortfolioResponse = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Balanz',
  createdAt: '2026-08-01T10:00:00.000Z',
  totals: [
    { currency: 'ARS', value: '20000000' },
    { currency: 'USD', value: '50000' },
  ],
  holdingsWithoutPrice: 0,
  holdings: [HOLDING],
};

function renderCard(portfolio: Partial<PortfolioResponse> = {}, locale: TestLocale = 'en') {
  const handlers = {
    onAddHolding: vi.fn(),
    onDeletePortfolio: vi.fn(),
    onEditHolding: vi.fn(),
    onSetPrice: vi.fn(),
    onDeleteHolding: vi.fn(),
  };
  renderApp(
    <PortfolioCard
      portfolio={{ ...PORTFOLIO, ...portfolio }}
      language={locale}
      timeZone="UTC"
      {...handlers}
    />,
    { locale },
  );
  return handlers;
}

function holdingOf(id: string, overrides: Partial<HoldingResponse>): HoldingResponse {
  return { ...HOLDING, id, ticker: id.toUpperCase(), ...overrides };
}

describe('PortfolioCard composition (AC-30, AC-31, AC-32)', () => {
  it('shows a donut of the priced holdings by instrument type with a legend of name and percentage', () => {
    renderCard({
      holdings: [
        holdingOf('a1', { instrumentType: 'stock', value: '60000' }),
        holdingOf('a2', { instrumentType: 'bond', value: '30000' }),
        holdingOf('a3', { instrumentType: 'crypto', value: '10000' }),
      ],
    });

    const chart = screen.getByRole('img', { name: /Composition by instrument type in ARS/ });
    const legend = chart.closest('figure')?.querySelectorAll('li');
    expect(legend).toHaveLength(3);
    expect(legend?.[0]?.textContent).toContain(en.investments.instrumentTypes.stock);
    expect(legend?.[0]?.textContent).toContain(formatPercentage(6000n, 'en'));
    expect(legend?.[2]?.textContent).toContain(en.investments.instrumentTypes.crypto);
  });

  it('draws one donut per valuation currency and never adds currencies together', () => {
    renderCard({
      holdings: [
        holdingOf('a1', { instrumentType: 'stock', value: '1000', valuationCurrency: 'ARS' }),
        holdingOf('a2', { instrumentType: 'stock', value: '9000', valuationCurrency: 'USD' }),
      ],
    });

    expect(screen.getByRole('img', { name: /in ARS/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /in USD/ })).toBeTruthy();
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('labels the chart in Spanish', () => {
    renderCard({ holdings: [holdingOf('a1', { instrumentType: 'bond', value: '5000' })] }, 'es');

    expect(
      screen.getByRole('img', {
        name: new RegExp(es.investments.portfolio.compositionLabel.split('{')[0] ?? ''),
      }),
    ).toBeTruthy();
  });

  it('error: with no priced holding there is no donut and the notice about missing prices stays', () => {
    renderCard({
      holdings: [holdingOf('a1', { value: null, gain: null, unitPrice: null })],
      holdingsWithoutPrice: 1,
    });

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('1 holding without price')).toBeTruthy();
  });

  it('error: a zero or negative value is left out of the chart', () => {
    renderCard({
      holdings: [
        holdingOf('a1', { instrumentType: 'stock', value: '0' }),
        holdingOf('a2', { instrumentType: 'stock', value: '-100' }),
        holdingOf('a3', { instrumentType: 'bond', value: '2000' }),
      ],
    });

    const legend = screen.getByRole('img').closest('figure')?.querySelectorAll('li');
    expect(legend).toHaveLength(1);
    expect(legend?.[0]?.textContent).toContain(en.investments.instrumentTypes.bond);
  });

  it('error: an instrument type this build does not know shows its raw key', () => {
    renderCard({
      holdings: [holdingOf('a1', { instrumentType: 'future_type' as never, value: '100' })],
    });

    expect(screen.getByRole('img').closest('figure')?.textContent).toContain('future_type');
  });
});

describe('PortfolioCard', () => {
  it('AC-13/AC-20: shows the name and the totals per currency', () => {
    renderCard();

    expect(screen.getByRole('heading', { name: 'Balanz' })).toBeTruthy();
    expect(screen.getByText('200,000.00 ARS')).toBeTruthy();
    expect(screen.getByText('500.00 USD')).toBeTruthy();
  });

  it('FEAT-004: heads the portfolio with its totals as a labelled list, one entry per currency', () => {
    renderCard();

    expect(screen.getByRole('heading', { name: 'Balanz' })).toBeTruthy();
    const totals = screen.getByRole('list', { name: en.investments.portfolio.totalsLabel });
    expect(totals.querySelectorAll('li')).toHaveLength(2);
  });

  it('AC-13/AC-20: formats the totals with Spanish separators in Spanish', () => {
    renderCard({}, 'es');

    expect(screen.getByText('200.000,00 ARS')).toBeTruthy();
    expect(screen.getByText('500,00 USD')).toBeTruthy();
  });

  it('AC-21: shows "2 holdings without price" for 2', () => {
    renderCard({ holdingsWithoutPrice: 2 });
    expect(screen.getByText('2 holdings without price')).toBeTruthy();
  });

  it('AC-21: uses the singular for 1 in English', () => {
    renderCard({ holdingsWithoutPrice: 1 });
    expect(screen.getByText('1 holding without price')).toBeTruthy();
  });

  it('AC-21: uses the plural for 2 in Spanish', () => {
    renderCard({ holdingsWithoutPrice: 2 }, 'es');
    expect(screen.getByText('2 posiciones sin precio')).toBeTruthy();
  });

  it('AC-21: uses the singular for 1 in Spanish', () => {
    renderCard({ holdingsWithoutPrice: 1 }, 'es');
    expect(screen.getByText('1 posición sin precio')).toBeTruthy();
  });

  it('AC-21: shows no indicator when every holding has a price', () => {
    renderCard({ holdingsWithoutPrice: 0 });
    expect(screen.queryByText(/without price/)).toBeNull();
  });

  it('lists the holdings as a list of rows', () => {
    renderCard();

    const list = screen.getByRole('list', { name: en.investments.portfolio.holdingsLabel });
    expect(list.querySelectorAll('li')).toHaveLength(1);
    expect(list.querySelectorAll('li > [data-slot="list-row"]')).toHaveLength(1);
    expect(screen.getByText('AAPL')).toBeTruthy();
  });

  it('shows an empty text when the portfolio has no holdings', () => {
    renderCard({ holdings: [], totals: [] });

    expect(screen.getByText(en.investments.portfolio.noHoldings)).toBeTruthy();
    expect(screen.queryByRole('list', { name: en.investments.portfolio.holdingsLabel })).toBeNull();
  });

  it('renders an unknown instrument type without error', () => {
    renderCard({
      holdings: [{ ...HOLDING, instrumentType: 'warrant' as HoldingResponse['instrumentType'] }],
    });

    // The row and the chart legend both show the raw key.
    expect(screen.getAllByText('warrant').length).toBeGreaterThan(0);
  });

  it('wires the add, delete and holding callbacks', async () => {
    const user = userEvent.setup();
    const handlers = renderCard();

    await user.click(screen.getByRole('button', { name: 'Add holding to Balanz' }));
    await user.click(screen.getByRole('button', { name: 'Delete portfolio Balanz' }));
    await user.click(screen.getByRole('button', { name: 'Show details for AAPL' }));
    await user.click(screen.getByRole('button', { name: 'Edit AAPL' }));

    expect(handlers.onAddHolding).toHaveBeenCalledWith(PORTFOLIO.id);
    expect(handlers.onDeletePortfolio).toHaveBeenCalledWith(PORTFOLIO.id);
    expect(handlers.onEditHolding).toHaveBeenCalledWith(HOLDING.id);
  });

  it('shows the empty text in Spanish', () => {
    renderCard({ holdings: [], totals: [] }, 'es');

    expect(screen.getByText(es.investments.portfolio.noHoldings)).toBeTruthy();
  });

  it('hides the holding actions when no holding callback is given', async () => {
    const user = userEvent.setup();
    renderApp(<PortfolioCard portfolio={PORTFOLIO} language="en" timeZone="UTC" />, {
      locale: 'en',
    });

    await user.click(screen.getByRole('button', { name: 'Show details for AAPL' }));

    expect(screen.queryByRole('button', { name: 'Edit AAPL' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set price for AAPL' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete AAPL' })).toBeNull();
  });

  it('hides the portfolio actions when no callback is given', () => {
    renderApp(<PortfolioCard portfolio={PORTFOLIO} language="en" timeZone="UTC" />, {
      locale: 'en',
    });

    expect(screen.queryByRole('button', { name: 'Add holding to Balanz' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete portfolio Balanz' })).toBeNull();
  });
});

describe('PortfolioCard automatic price callback (DISC-001-07b)', () => {
  it('passes the callback to the warned holding only', async () => {
    const warned: HoldingResponse = {
      ...HOLDING,
      marketUnitPrice: '2050000',
      marketPricedAt: '2026-09-30T23:30:00.000Z',
      marketPriceDiffers: true,
      marketPriceRecent: true,
    };
    const calm: HoldingResponse = {
      ...HOLDING,
      id: '33333333-3333-4333-8333-333333333333',
      ticker: 'MSFT',
    };
    const onUseAutomaticPrice = vi.fn();
    renderApp(
      <PortfolioCard
        portfolio={{ ...PORTFOLIO, holdings: [calm, warned] }}
        language="en"
        timeZone="UTC"
        onUseAutomaticPrice={onUseAutomaticPrice}
      />,
      { locale: 'en' },
    );

    expect(screen.queryByRole('button', { name: 'Use automatic price for MSFT' })).toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Use automatic price for AAPL' }));

    expect(onUseAutomaticPrice).toHaveBeenCalledWith(HOLDING.id);
    expect(screen.getAllByRole('button', { name: /Use automatic price/ })).toHaveLength(1);
  });
});
