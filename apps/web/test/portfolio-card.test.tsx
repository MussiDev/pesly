// @vitest-environment happy-dom
import type { HoldingResponse, PortfolioResponse } from '@pesly/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PortfolioCard } from '../src/features/investments/components/portfolio-card';
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

describe('PortfolioCard', () => {
  it('AC-13/AC-20: shows the name and the totals per currency', () => {
    renderCard();

    expect(screen.getByRole('heading', { name: 'Balanz' })).toBeTruthy();
    expect(screen.getByText('200,000.00 ARS')).toBeTruthy();
    expect(screen.getByText('500.00 USD')).toBeTruthy();
  });

  it('FEAT-004: is a card with the totals as a labelled list, one entry per currency', () => {
    renderCard();

    const card = screen.getByRole('heading', { name: 'Balanz' }).closest('[data-slot="card"]');
    expect(card).not.toBeNull();
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

    expect(screen.getByText('warrant')).toBeTruthy();
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
