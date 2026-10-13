// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GroupRecentExpenses } from '../src/features/groups/components/group-recent-expenses';
import { GroupSuggestedPaymentsSection } from '../src/features/groups/components/group-suggested-payments-section';
import type { CurrencyBalanceView } from '../src/features/groups/settlements/balance-view';
import type { ExpenseListItem } from '../src/features/groups/expenses/list/group-expenses-list';
import { CATALOGS, renderApp } from './support/render-app';

const { en, es } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const ANA = '11111111-1111-4111-8111-111111111111';
const BRUNO = '22222222-2222-4222-8222-222222222222';

const view = (
  currency: 'ARS' | 'USD',
  payments: CurrencyBalanceView['payments'] = [],
): CurrencyBalanceView => ({ currency, settled: payments.length === 0, rows: [], payments });

const payment = (amount: bigint) => ({
  fromMemberId: BRUNO,
  toMemberId: ANA,
  fromName: 'Bruno',
  toName: 'Ana',
  amount,
});

const item = (n: number, description = `Expense ${n}`): ExpenseListItem => ({
  id: `88888888-8888-4888-8888-88888888000${String(n)}`,
  description,
  category: {
    id: 'c',
    label: 'Groceries',
    icon: 'utensils',
    color: 'orange',
    archived: false,
    known: true,
  },
  payer: 'Ana',
  amount: '15,000.50 ARS',
  date: 'Oct 5, 2026',
  share: undefined,
});

const renderPayments = (
  props: Partial<Parameters<typeof GroupSuggestedPaymentsSection>[0]> = {},
  locale: 'en' | 'es' = 'en',
) =>
  renderApp(
    <GroupSuggestedPaymentsSection
      status="ready"
      views={[view('ARS', [payment(1500000n)]), view('USD', [payment(2500n)])]}
      onRetry={vi.fn()}
      onRecord={vi.fn()}
      {...props}
    />,
    { locale },
  );

const renderRecent = (
  props: Partial<Parameters<typeof GroupRecentExpenses>[0]> = {},
  locale: 'en' | 'es' = 'en',
) =>
  renderApp(
    <GroupRecentExpenses
      groupId={GROUP_ID}
      status="ready"
      items={[item(1), item(2)]}
      onRetry={vi.fn()}
      {...props}
    />,
    { locale },
  );

describe('GroupSuggestedPaymentsSection', () => {
  it('lists the payments of each currency with payer, payee, amount and a Record button', () => {
    renderPayments();

    expect(screen.getByRole('heading', { name: en.groups.detail.suggestedTitle })).toBeTruthy();
    expect(screen.getByText('Bruno pays Ana 15,000.00 ARS')).toBeTruthy();
    expect(screen.getByText('Bruno pays Ana 25.00 USD')).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: /Record payment from Bruno to Ana/ }),
    ).toHaveLength(2);
  });

  it('calls onRecord with the currency and the payment that was pressed', async () => {
    const onRecord = vi.fn();
    renderPayments({ onRecord });

    const buttons = screen.getAllByRole('button', { name: /Record payment from Bruno to Ana/ });
    await userEvent.click(buttons[1] as HTMLElement);

    expect(onRecord).toHaveBeenCalledWith('USD', payment(2500n));
  });

  it('shows the settled message and no rows when no currency has a payment', () => {
    renderPayments({ views: [view('ARS'), view('USD')] });

    expect(screen.getByText(en.groups.detail.allSettled)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a retry button on a failed (error) state and calls it', async () => {
    const onRetry = vi.fn();
    renderPayments({ status: 'failed', onRetry });

    expect(screen.getByText(en.groups.detail.sectionFailed)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: en.app.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows at most 5 skeleton rows while loading', () => {
    const { container } = renderPayments({ status: 'loading' });

    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
    expect(skeletons.length).toBeLessThanOrEqual(5);
  });

  it('renders from the Spanish catalog', () => {
    renderPayments({}, 'es');

    expect(screen.getByRole('heading', { name: es.groups.detail.suggestedTitle })).toBeTruthy();
    expect(screen.getAllByText(/Bruno le paga a Ana/)).toHaveLength(2);
  });
});

describe('GroupRecentExpenses', () => {
  it('shows the rows, with no row actions, and the See all link to the expenses page', () => {
    renderRecent();

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).queryByRole('button')).toBeNull();
    expect(within(list).queryByRole('link')).toBeNull();
    const link = screen.getByRole('link', { name: en.groups.detail.seeAll });
    expect(link.getAttribute('href')).toBe(`/en/groups/${GROUP_ID}/expenses`);
  });

  it('shows the empty message and the link to the expenses page when there are no items', () => {
    renderRecent({ items: [] });

    expect(screen.getByText(en.groups.detail.recentEmpty)).toBeTruthy();
    const link = screen.getByRole('link', { name: en.groups.detail.recentEmptyLink });
    expect(link.getAttribute('href')).toBe(`/en/groups/${GROUP_ID}/expenses`);
  });

  it('shows a retry button on a failed (error) state and calls it', async () => {
    const onRetry = vi.fn();
    renderRecent({ status: 'failed', onRetry });

    expect(screen.getByText(en.groups.detail.sectionFailed)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: en.app.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows at most 5 skeleton rows while loading', () => {
    const { container } = renderRecent({ status: 'loading' });

    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
    expect(skeletons.length).toBeLessThanOrEqual(5);
  });

  it('renders a description such as <img onerror> as literal text, never as markup', () => {
    const { container } = renderRecent({ items: [item(1, '<img src=x onerror=alert(1)>')] });

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders from the Spanish catalog', () => {
    renderRecent({}, 'es');

    expect(screen.getByRole('heading', { name: es.groups.detail.recentTitle })).toBeTruthy();
    expect(screen.getByRole('link', { name: es.groups.detail.seeAll })).toBeTruthy();
  });

  it('renders from props alone and makes no request of its own', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    renderRecent();

    expect(fetch).not.toHaveBeenCalled();
  });
});
