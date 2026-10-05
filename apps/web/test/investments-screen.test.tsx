// @vitest-environment happy-dom
import type { PortfolioResponse } from '@pesly/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  InvestmentsScreen,
  type InvestmentsScreenProps,
} from '../src/features/investments/components/investments-screen';
import { HOLDING } from './support/holding-fixture';
import { CATALOGS, renderApp } from './support/render-app';

const { es } = CATALOGS;
const inv = es.investments;

const PORTFOLIO: PortfolioResponse = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Balanz',
  createdAt: '2026-08-01T10:00:00.000Z',
  totals: [{ currency: 'ARS', value: '18500000' }],
  holdingsWithoutPrice: 0,
  holdings: [HOLDING],
};

function props(overrides: Partial<InvestmentsScreenProps> = {}): InvestmentsScreenProps {
  return {
    state: 'loaded',
    portfolios: [PORTFOLIO],
    language: 'es',
    timeZone: 'UTC',
    pending: false,
    openForm: null,
    createRevision: 0,
    notice: null,
    messages: {},
    formErrors: undefined,
    onRetry: vi.fn(),
    onOpenForm: vi.fn(),
    onCloseForm: vi.fn(),
    onCreatePortfolio: vi.fn(),
    onAddHolding: vi.fn(),
    onEditHolding: vi.fn(),
    onSetPrice: vi.fn(),
    onDeleteHolding: vi.fn(),
    onDeletePortfolio: vi.fn(),
    ...overrides,
  };
}

describe('InvestmentsScreen with the design system (FEAT-004)', () => {
  it('draws its loading skeleton with the card radius (AC-35)', () => {
    const { container } = renderApp(<InvestmentsScreen {...props({ state: 'loading' })} />);

    expect(container.querySelector('[data-slot="skeleton"].rounded-card')).not.toBeNull();
  });

  it('AC-21: shows a skeleton and announces the loading state while loading', () => {
    const { container } = renderApp(<InvestmentsScreen {...props({ state: 'loading' })} />);

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.getByRole('status').textContent).toBe(es.app.loading);
    expect(screen.queryByRole('heading', { name: 'Balanz' })).toBeNull();
  });

  it('AC-22: with no portfolio shows an empty state whose call to action is the create form', () => {
    const { container } = renderApp(<InvestmentsScreen {...props({ portfolios: [] })} />);

    const empty = container.querySelector<HTMLElement>('[data-slot="empty-state"]');
    expect(empty).not.toBeNull();
    const scope = within(empty as HTMLElement);
    expect(scope.getByRole('heading', { name: inv.empty.title })).toBeDefined();
    expect(scope.getByText(inv.empty.description)).toBeDefined();
    expect(scope.getByLabelText(inv.forms.createPortfolio.name)).toBeDefined();
    expect(scope.getByRole('button', { name: inv.forms.createPortfolio.submit })).toBeDefined();
  });

  it('shows the error state with the reason and a retry that works', async () => {
    const onRetry = vi.fn();
    const { container } = renderApp(
      <InvestmentsScreen {...props({ state: 'failed', loadError: 'network', onRetry })} />,
    );

    expect(screen.getByRole('alert').textContent).toContain(inv.errors.network);
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: es.app.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous list and shows the error state with retry when a reload fails', async () => {
    const onRetry = vi.fn();
    renderApp(<InvestmentsScreen {...props({ loadError: 'network', onRetry })} />);

    expect(screen.getByRole('alert').textContent).toContain(inv.errors.network);
    expect(screen.getByRole('heading', { name: 'Balanz' })).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: es.app.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('opens the add-holding form as a focused card under its portfolio', () => {
    const { container } = renderApp(
      <InvestmentsScreen {...props({ openForm: { kind: 'add', portfolioId: PORTFOLIO.id } })} />,
    );

    const heading = screen.getByRole('heading', { name: inv.forms.addHolding.title });
    expect(heading.closest('[data-slot="card"]')).not.toBeNull();
    // The portfolio is laid out on the canvas; only the open form is a card.
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
    expect(document.activeElement).toBe(heading);
  });

  it('uses the destructive variant for the portfolio delete confirmation', () => {
    renderApp(
      <InvestmentsScreen
        {...props({ openForm: { kind: 'delete-portfolio', portfolioId: PORTFOLIO.id } })}
      />,
    );

    const confirm = screen.getByRole('button', { name: inv.forms.confirmDelete.confirm });
    expect(confirm.className).toContain('bg-destructive');
  });

  it('shows an invalid holding submission with its field error and focuses the first invalid field', async () => {
    renderApp(
      <InvestmentsScreen {...props({ openForm: { kind: 'add', portfolioId: PORTFOLIO.id } })} />,
    );

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: inv.forms.addHolding.submit }));

    const ticker = screen.getByLabelText(inv.forms.addHolding.ticker);
    expect(ticker.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(inv.errors.tickerInvalid)).toBeDefined();
    expect(document.activeElement).toBe(ticker);
  });
});
