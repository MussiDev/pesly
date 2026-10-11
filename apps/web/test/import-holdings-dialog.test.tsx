// @vitest-environment happy-dom
import {
  planHoldingsImport,
  type HoldingResponse,
  type ImportHolding,
  type ValuationCurrency,
} from '@pesly/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ImportHoldingsDialog,
  type ImportDialogError,
} from '../src/features/investments/components/import-holdings-dialog';
import { CATALOGS, renderApp, type TestLocale } from './support/render-app';

const labels = (locale: TestLocale) => CATALOGS[locale].investments.import;

const CURRENT = {
  id: '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10',
  portfolioId: '9b1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b',
  ticker: 'AAPL',
  instrumentName: 'Apple',
  instrumentType: 'cedear',
  quantity: '100000000',
  valuationCurrency: 'ARS',
  totalCost: null,
  unitPrice: null,
  priceSource: null,
  pricedAt: null,
  priceStale: false,
  marketUnitPrice: null,
  marketPricedAt: null,
  marketPriceDiffers: false,
  marketPriceRecent: false,
  value: null,
  gain: null,
} satisfies HoldingResponse;

function incoming(ticker: string, overrides: Partial<ImportHolding> = {}): ImportHolding {
  return {
    ticker,
    instrumentName: `${ticker} CEDEAR`,
    instrumentType: 'cedear',
    valuationCurrency: 'ARS',
    quantity: '4600000000',
    totalCost: '41949600',
    unitPrice: '753500',
    pricedOn: '2026-10-09',
    ...overrides,
  };
}

function render(
  locale: TestLocale = 'en',
  props: Partial<Parameters<typeof ImportHoldingsDialog>[0]> = {},
) {
  const handlers = {
    onFile: vi.fn(),
    onCurrencyChange: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };
  const holdings = [incoming('IBIT'), incoming('SPY')];
  renderApp(
    <ImportHoldingsDialog
      language={locale}
      pending={false}
      reading={false}
      plan={planHoldingsImport([CURRENT], holdings)}
      error={null}
      {...handlers}
      {...props}
    />,
    { locale },
  );
  return { ...handlers, user: userEvent.setup() };
}

describe('ImportHoldingsDialog preview (DISC-001-07c FR-02)', () => {
  it('lists what will be created and removed before anything is sent (AC-02)', () => {
    const { onConfirm } = render('en');
    const t = labels('en');

    expect(screen.getByText('2 to add, 0 to update, 1 to remove.')).toBeTruthy();
    const create = screen.getByRole('list', { name: t.preview.create });
    expect(within(create).getAllByRole('listitem')).toHaveLength(2);
    const remove = screen.getByRole('list', { name: t.preview.remove });
    expect(within(remove).getByText('AAPL')).toBeTruthy();
    expect(screen.getByText(t.preview.removeWarning)).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('lists the holdings it will update separately', () => {
    render('en', { plan: planHoldingsImport([CURRENT], [incoming('aapl'), incoming('SPY')]) });

    expect(screen.getByText('1 to add, 1 to update, 0 to remove.')).toBeTruthy();
    const update = screen.getByRole('list', { name: labels('en').preview.update });
    expect(within(update).getByText('aapl')).toBeTruthy();
    expect(screen.queryByRole('list', { name: labels('en').preview.remove })).toBeNull();
  });

  it('shows every holding in ARS and reports a switch to USD for that holding only (AC-09)', async () => {
    const { onCurrencyChange, user } = render('en');

    const ibit = screen.getByLabelText('Currency of IBIT');
    const spy = screen.getByLabelText('Currency of SPY');
    expect((ibit as HTMLSelectElement).value).toBe('ARS');
    expect((spy as HTMLSelectElement).value).toBe('ARS');
    await user.selectOptions(spy, 'USD');

    expect(onCurrencyChange).toHaveBeenCalledExactlyOnceWith(
      'SPY',
      'USD' satisfies ValuationCurrency,
    );
  });

  it('shows the chosen currency of a holding that the parent switched to USD (AC-09)', () => {
    render('en', {
      plan: planHoldingsImport([], [incoming('SPY', { valuationCurrency: 'USD' })]),
    });

    expect(screen.getByLabelText<HTMLSelectElement>('Currency of SPY').value).toBe('USD');
  });

  it('shows the type of each holding, "Other" for an unrecognized one (AC-10)', () => {
    render('en', {
      plan: planHoldingsImport(
        [],
        [incoming('WAR1', { instrumentType: 'other' }), incoming('IBIT')],
      ),
    });

    expect(screen.getByText('Type: Other')).toBeTruthy();
    expect(screen.getByText('Type: CEDEAR')).toBeTruthy();
  });

  it('renders names with markup or formulas as plain text (threat R-08)', () => {
    const dangerous = '<img src=x onerror=alert(1)>';
    const { container } = renderApp(
      <ImportHoldingsDialog
        language="en"
        pending={false}
        reading={false}
        plan={planHoldingsImport([], [incoming('IBIT', { instrumentName: dangerous })])}
        error={null}
        onFile={vi.fn()}
        onCurrencyChange={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
      { locale: 'en' },
    );

    expect(screen.getByText(dangerous)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('formats the quantity in the language of the user', () => {
    render('es', {
      plan: planHoldingsImport([], [incoming('IBIT', { quantity: '123456789012' })]),
    });

    expect(screen.getByText(/1\.234,56789012/)).toBeTruthy();
  });
});

describe('ImportHoldingsDialog actions', () => {
  it('confirms and cancels through the parent (AC-03, AC-04)', async () => {
    const { onConfirm, onCancel, user } = render('en');
    const t = labels('en');

    await user.click(screen.getByRole('button', { name: t.cancel }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: t.confirm }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('disables the confirm button and shows the pending label while importing', () => {
    render('en', { pending: true });

    const button = screen.getByRole('button', { name: labels('en').pending });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('hands the chosen file to the parent through a labelled input that takes only .xlsx', async () => {
    const { onFile, user } = render('en', { plan: null });
    const input = screen.getByLabelText<HTMLInputElement>(labels('en').fileLabel);
    const file = new File(['x'], 'holdings.xlsx');

    expect(input.type).toBe('file');
    expect(input.accept).toContain('.xlsx');
    await user.upload(input, file);

    expect(onFile).toHaveBeenCalledExactlyOnceWith(file);
  });

  it('has no confirm button until a file was read, and says when it is reading', () => {
    render('en', { plan: null, reading: true });

    expect(screen.queryByRole('button', { name: labels('en').confirm })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(labels('en').reading);
    expect(screen.getByLabelText<HTMLInputElement>(labels('en').fileLabel).disabled).toBe(true);
  });
});

describe('ImportHoldingsDialog errors (FR-04)', () => {
  it.each(['en', 'es'] as const)(
    'shows a rejected file as an alert in %s with no confirm button (AC-05, AC-07)',
    (locale) => {
      const error: ImportDialogError = { scope: 'import', key: 'wrongSheet' };
      render(locale, { plan: null, error });

      expect(screen.getByRole('alert').textContent).toContain(labels(locale).errors.wrongSheet);
      expect(screen.queryByRole('button', { name: labels(locale).confirm })).toBeNull();
    },
  );

  it('fills the row number and the missing columns of the message, never a cell value', () => {
    render('en', { plan: null, error: { scope: 'import', key: 'badRow', detail: '3' } });
    expect(screen.getByRole('alert').textContent).toBe(
      'Row 3 of the file is not valid. Nothing was imported.',
    );
  });

  it('shows an API failure above the preview and keeps the preview open (AC-05)', () => {
    render('en', { error: { scope: 'api', key: 'network' } });

    expect(screen.getByRole('alert').textContent).toContain(CATALOGS.en.investments.errors.network);
    expect(screen.getByRole('button', { name: labels('en').confirm })).toBeTruthy();
  });
});
