// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import { loadAccountOptions } from '../src/features/reports/load-account-options';
import { ChartFigure } from '../src/features/reports/components/figures-list';
import { ReportFootnote, ReportPeriod } from '../src/features/reports/components/report-meta';
import {
  ReportFilters,
  type ReportFiltersProps,
} from '../src/features/reports/components/report-filters';
import { ReportNotices } from '../src/features/reports/components/report-notices';
import {
  FilterGoneAlert,
  RangeAlert,
  RANGE_ALERT_ID,
  ReportEmpty,
  ReportError,
  ReportLoading,
  ReportOffline,
} from '../src/features/reports/components/report-states';
import { ReportTabs } from '../src/features/reports/components/report-tabs';
import type { ListAccountsResponse } from '@pesly/shared';
import type { ApiFailure, ApiResult } from '../src/lib/api-client';
import { formatMoney } from '../src/lib/format-amount';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
      {ui}
    </NextIntlClientProvider>
  );
}
const show = (ui: React.ReactNode) => render(wrap(ui));

function viewport(compact: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: compact,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

const ACCOUNT = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';

function bar(props: Partial<ReportFiltersProps> = {}) {
  const onChange = vi.fn();
  show(
    <ReportFilters
      kind="categories"
      filters={{}}
      accounts={[{ id: ACCOUNT, label: 'Cash' }]}
      today="2026-10-12"
      onChange={onChange}
      renderTagField={() => <input aria-label="tag-slot" />}
      {...props}
    />,
  );
  return onChange;
}

describe('ReportTabs', () => {
  it('shows three names and marks the current one (AC-01, AC-02)', () => {
    show(<ReportTabs current="/reports/income-expenses" />);
    const nav = screen.getByRole('navigation', { name: 'Report sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Categories',
      'Income & expenses',
      'Net worth',
    ]);
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, 'page', null]);
    expect(links.every((link) => link.className.includes('min-h-11'))).toBe(true);
  });

  it('marks nothing for an unknown path', () => {
    show(<ReportTabs current="/movements" />);
    expect(document.querySelector('[aria-current]')).toBeNull();
  });
});

describe('ReportFilters', () => {
  it('a flow report shows range, account and tag controls (AC-24)', () => {
    viewport(false);
    bar();
    expect(screen.getByRole('button', { name: 'This month' })).toBeTruthy();
    expect(screen.getByLabelText('From')).toBeTruthy();
    expect(screen.getByLabelText('To')).toBeTruthy();
    expect(screen.getByLabelText('Account')).toBeTruthy();
    expect(screen.getByLabelText('tag-slot')).toBeTruthy();
  });

  it('net worth shows the range only and offers last 24 months (AC-25)', () => {
    viewport(false);
    bar({ kind: 'netWorth' });
    expect(screen.getByRole('button', { name: '24 months' })).toBeTruthy();
    expect(screen.queryByLabelText('Account')).toBeNull();
    expect(screen.queryByLabelText('tag-slot')).toBeNull();
  });

  it('income against expenses has no last-24 preset (AC-29)', () => {
    viewport(false);
    bar({ kind: 'incomeExpenses' });
    expect(screen.queryByRole('button', { name: '24 months' })).toBeNull();
    expect(screen.getByRole('button', { name: '12 months' })).toBeTruthy();
  });

  it('a preset calls onChange once with its dates (AC-28)', async () => {
    viewport(false);
    const onChange = bar({ filters: { tag: 'trip' } });
    await userEvent.setup().click(screen.getByRole('button', { name: '3 months' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ tag: 'trip', from: '2026-08-01', to: '2026-10-12' });
  });

  it('marks the active preset and the default one with no dates', () => {
    viewport(false);
    bar({ kind: 'netWorth', filters: {} });
    expect(screen.getByRole('button', { name: '12 months' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    cleanup();
    bar({ filters: { from: '2026-01-05', to: '2026-02-05' } });
    // A custom range presses no preset: its dates show in the fields.
    expect(document.querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it('a from after to marks both fields invalid, shows the message and sends nothing (AC-32)', () => {
    viewport(false);
    const onChange = bar({ filters: { from: '2026-05-01', to: '2026-05-10' } });
    const from = screen.getByLabelText('From');
    fireEvent.change(from, { target: { value: '2026-06-01' } });
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ from: '2026-06-01' }));
    expect(from.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('To').getAttribute('aria-invalid')).toBe('true');
    const message = screen.getByText('The start date must not be after the end date.');
    expect(from.getAttribute('aria-describedby')).toBe(message.id);
  });

  it('13 months on income against expenses states the limit of 12 and sends nothing (AC-33)', () => {
    viewport(false);
    const onChange = bar({
      kind: 'incomeExpenses',
      filters: { from: '2026-01-01', to: '2026-05-01' },
    });
    const from = screen.getByLabelText('From');
    fireEvent.change(from, { target: { value: '2025-03-01' } });
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ from: '2025-03-01' }));
    expect(screen.getByText('The range is too long: the limit is 12 months.')).toBeTruthy();
  });

  it('a valid typed pair reaches onChange once', () => {
    viewport(false);
    const onChange = bar({ filters: { from: '2026-05-01', to: '2026-05-10' } });
    const to = screen.getByLabelText('To');
    fireEvent.change(to, { target: { value: '2026-05-20' } });
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-05-01', to: '2026-05-20' });
  });

  it('the account selector holds the loaded ids and the empty value', async () => {
    viewport(false);
    const onChange = bar();
    const select = screen.getByLabelText('Account');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All accounts', 'Cash']);
    await userEvent.setup().selectOptions(select, ACCOUNT);
    expect(onChange).toHaveBeenCalledWith({ accountId: ACCOUNT });
  });

  it('with no accounts loaded the selector is empty and the tag still works', () => {
    viewport(false);
    bar({ accounts: [] });
    expect(within(screen.getByLabelText('Account')).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByLabelText('tag-slot')).toBeTruthy();
  });

  it('clear resets every filter at once', async () => {
    viewport(false);
    const onChange = bar({ filters: { tag: 'trip', accountId: ACCOUNT } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it('under 1024 px the filters sit behind one control naming the active count (AC-50)', async () => {
    viewport(true);
    bar({ filters: { tag: 'trip', accountId: ACCOUNT } });
    const toggle = screen.getByRole('button', { name: 'More filters (2)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Account')).toBeNull();
    await userEvent.setup().click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Account')).toBeTruthy();
  });

  it('under 1024 px a local range problem is worded outside the collapsed panel (M1)', async () => {
    viewport(true);
    bar({ filters: { from: '2026-05-10', to: '2026-05-01' } });
    const toggle = screen.getByRole('button', { name: /^More filters/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('From')).toBeNull();
    const text = 'The start date must not be after the end date.';
    expect(screen.getByRole('alert').textContent).toBe(text);
    await userEvent.setup().click(toggle);
    // Open: the message sits with the fields, and it is still said only once.
    expect(screen.getAllByText(text)).toHaveLength(1);
    expect(screen.getByLabelText('From').getAttribute('aria-describedby')).toBe(
      screen.getByText(text).id,
    );
  });

  it('shows the limit of the range next to the date fields at all times (FR-15)', () => {
    viewport(false);
    bar({ kind: 'incomeExpenses' });
    expect(screen.getByText('The range can cover up to 12 months.')).toBeTruthy();
    cleanup();
    bar({ kind: 'netWorth' });
    expect(screen.getByText('The range can cover up to 24 months.')).toBeTruthy();
  });

  it('refuses an end date after today locally and says so (L1)', () => {
    viewport(false);
    const onChange = bar({ filters: { from: '2026-10-01', to: '2026-10-10' } });
    const to = screen.getByLabelText('To');
    fireEvent.change(to, { target: { value: '2026-10-13' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('The end date cannot be in the future.')).toBeTruthy();
    expect(to.getAttribute('aria-invalid')).toBe('true');
  });

  it('wires the server range alert to the field the server named (L1)', () => {
    viewport(false);
    bar({ serverField: 'to' });
    expect(screen.getByLabelText('To').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('To').getAttribute('aria-describedby')).toBe(RANGE_ALERT_ID);
    expect(screen.getByLabelText('From').getAttribute('aria-invalid')).toBe('false');
    expect(screen.getByLabelText('From').getAttribute('aria-describedby')).toBeNull();
  });

  it('keeps the active account visible when it is not among the options (M6)', () => {
    viewport(false);
    const OTHER = '9f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a99';
    bar({ filters: { accountId: OTHER }, accounts: [] });
    const select = screen.getByLabelText<HTMLSelectElement>('Account');
    expect(select.value).toBe(OTHER);
    expect(within(select).getByRole('option', { name: 'Account not available' })).toBeTruthy();
  });

  it('from 1024 px the filters are open and there is no toggle (AC-50)', () => {
    viewport(false);
    bar();
    expect(screen.queryByRole('button', { name: /^More filters/ })).toBeNull();
    expect(screen.getByLabelText('Account')).toBeTruthy();
  });
});

describe('ReportPeriod and ReportFootnote', () => {
  it('names the range and the currency in one line, and links the currency setting (AC-35)', () => {
    show(
      <>
        <ReportPeriod from="2026-10-01" to="2026-10-31" currency="USD" />
        <ReportFootnote cardPurchases />
      </>,
    );
    expect(screen.getByText('Oct 1, 2026 – Oct 31, 2026 · in USD')).toBeTruthy();
    expect(screen.getByText(/Amounts are in your profile currency\./)).toBeTruthy();
    expect(document.querySelector('[data-slot="card-purchases-note"]')).not.toBeNull();
    const link = screen.getByRole('link', { name: 'Change currency' });
    expect(link.getAttribute('href')).toContain('/settings/profile');
  });

  it('a USD figure formats as USD without mixing currencies (AC-36)', () => {
    expect(formatMoney(123456n, 'USD', 'en')).toContain('USD');
    expect(formatMoney(123456n, 'USD', 'en')).not.toContain('ARS');
  });
});

describe('ReportNotices', () => {
  it('shows both counts for 2 and 1 (AC-37)', () => {
    show(<ReportNotices unconvertedShares={2} unconvertedInstallments={1} filtered={false} />);
    expect(screen.getByText(/2 group shares and 1 installment/)).toBeTruthy();
  });

  it('shows nothing for 0 and 0 (AC-37)', () => {
    const { container } = render(
      wrap(<ReportNotices unconvertedShares={0} unconvertedInstallments={0} filtered={false} />),
    );
    expect(container.textContent).toBe('');
  });

  it('shows the counts notice when only one count is above 0', () => {
    show(<ReportNotices unconvertedShares={0} unconvertedInstallments={3} filtered={false} />);
    expect(screen.getByText(/3 installments/)).toBeTruthy();
  });

  it('shows the filtered notice only with a filter (AC-38, AC-39)', () => {
    show(<ReportNotices unconvertedShares={0} unconvertedInstallments={0} filtered />);
    expect(screen.getByText(/not part of a report filtered by account or tag/)).toBeTruthy();
    cleanup();
    show(<ReportNotices unconvertedShares={0} unconvertedInstallments={0} filtered={false} />);
    expect(screen.queryByText(/not part of a report filtered/)).toBeNull();
  });
});

describe('report states', () => {
  it('the skeleton announces loading and leaves the controls operable (AC-40)', async () => {
    viewport(false);
    const onChange = vi.fn();
    show(
      <>
        <ReportFilters
          kind="categories"
          filters={{}}
          accounts={[]}
          today="2026-10-12"
          onChange={onChange}
        />
        <ReportLoading />
      </>,
    );
    expect(screen.getByRole('status').textContent).toContain('Loading the report');
    await userEvent.setup().click(screen.getByRole('button', { name: '3 months' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('the loading state takes a screen-specific layout', () => {
    show(<ReportLoading>{<div data-testid="custom" />}</ReportLoading>);
    expect(screen.getByTestId('custom')).toBeTruthy();
  });

  it('the empty state names the range and offers both actions (AC-41)', async () => {
    const onWiden = vi.fn();
    show(<ReportEmpty from="2026-10-01" to="2026-10-12" onWiden={onWiden} />);
    expect(screen.getByText('No movements in this range')).toBeTruthy();
    expect(screen.getByText(/Oct 1, 2026 and Oct 12, 2026/)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Widen the range' }));
    expect(onWiden).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Record a movement' }).getAttribute('href')).toContain(
      '/movements/new',
    );
  });

  it('the error state has a retry button, disabled with the retrying label while in flight (AC-42)', async () => {
    const onRetry = vi.fn();
    const view = show(<ReportError retrying={false} onRetry={onRetry} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    view.rerender(wrap(<ReportError retrying onRetry={onRetry} />));
    const busy = screen.getByRole('button', { name: 'Trying again…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
  });

  it('the error state shows catalog text only', () => {
    show(<ReportError retrying={false} onRetry={vi.fn()} />);
    expect(screen.getByText('The report could not be loaded')).toBeTruthy();
  });

  it('the offline state offers a retry', async () => {
    const onRetry = vi.fn();
    show(<ReportOffline onRetry={onRetry} />);
    expect(screen.getByText('Reports need a connection')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('the filter-gone alert asks to clear the entity filters (AC-27)', async () => {
    const onReload = vi.fn();
    show(<FilterGoneAlert onReload={onReload} />);
    expect(screen.getByText('The account or tag you filtered by no longer exists.')).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Clear the filters and reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('the range alert shows the catalog message (AC-34)', () => {
    show(<RangeAlert />);
    expect(screen.getByRole('alert').textContent).toContain('The date range is not valid');
  });
});

describe('ChartFigure', () => {
  it('exposes the chart name and summary while the drawing is hidden (AC-46)', () => {
    show(
      <ChartFigure name="Chart name" summary="Chart summary">
        <svg data-testid="drawing" />
      </ChartFigure>,
    );
    expect(screen.getByRole('figure', { name: 'Chart name' })).toBeTruthy();
    expect(screen.getByText('Chart summary')).toBeTruthy();
    expect(screen.getByTestId('drawing').closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('loadAccountOptions', () => {
  const account = (id: string, name: string, archived: boolean) => ({ id, name, archived });
  const page = (items: unknown[]): ApiResult<ListAccountsResponse> => ({
    ok: true,
    data: { items, total: items.length } as ListAccountsResponse,
  });

  it('lists active accounts first and labels the archived ones (D7)', async () => {
    const listAccounts = vi.fn(({ archived }: { archived: boolean }) =>
      Promise.resolve(
        archived ? page([account('b', 'Old', true)]) : page([account('a', 'Cash', false)]),
      ),
    );
    const result = await loadAccountOptions({ listAccounts }, (name) => `${name} (archived)`);
    expect(result).toEqual([
      { id: 'a', label: 'Cash' },
      { id: 'b', label: 'Old (archived)' },
    ]);
  });

  it('gives an empty list when a call fails, never blocking the report', async () => {
    const failure: ApiFailure = {
      ok: false,
      code: 'NETWORK',
      messageKey: 'generic' as ApiFailure['messageKey'],
    };
    const listAccounts = vi.fn(() => Promise.resolve(failure));
    expect(await loadAccountOptions({ listAccounts }, (n) => n)).toEqual([]);
  });
});
