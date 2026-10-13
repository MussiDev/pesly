// @vitest-environment happy-dom
import { formatMoney, type BudgetSpendingResponse } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BudgetProgress } from '../src/features/budgets/list/budget-progress';
import { BudgetsContainer } from '../src/features/budgets/list/budgets-container';
import { UnconvertedNotice } from '../src/features/budgets/list/unconverted-notice';
import { toBudgetView } from '../src/features/budgets/helpers/budget-view';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;

const BUDGET_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';

function spending(overrides: Partial<BudgetSpendingResponse> = {}): BudgetSpendingResponse {
  return {
    budgetId: BUDGET_ID,
    name: 'Food',
    currency: 'ARS',
    month: '2026-10',
    amount: '100000',
    rolloverEnabled: false,
    rolloverAmount: '0',
    available: '100000',
    spent: '25000',
    remaining: '75000',
    percentUsed: 25,
    thresholds: [80, 100],
    unconvertedShareCount: 0,
    unconvertedInstallmentCount: 0,
    ...overrides,
  };
}

function list(budgets: BudgetSpendingResponse[], month = '2026-10') {
  return { status: 200, body: { month, budgets } };
}

// Amounts join the currency with a non-breaking space, so compare with whitespace flattened.
const flat = (text: string) => text.replace(/\s+/g, ' ');
const hasText = (expected: string) => (content: string) => flat(content).includes(flat(expected));

const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template);

const percent = (locale: string, fraction: number) =>
  new Intl.NumberFormat(locale, { style: 'percent' }).format(fraction);

describe('BudgetsContainer', () => {
  it.each([
    ['es', es],
    ['en', en],
  ] as const)(
    'shows name, currency, spent, available, remaining and percentage (%s, AC-01, AC-30)',
    async (locale, catalog) => {
      stubApi({ 'GET /budgets/spending': list([spending()]) });
      renderApp(<BudgetsContainer />, { locale });

      const card = await screen.findByRole('listitem', { name: 'Food' });
      expect(within(card).getByText('ARS')).toBeDefined();
      expect(
        within(card).getByText(
          hasText(
            fill(catalog.budgets.card.spentOfAvailable, {
              spent: formatMoney(25000n, 'ARS', locale),
              available: formatMoney(100000n, 'ARS', locale),
            }),
          ),
        ),
      ).toBeDefined();
      expect(
        within(card).getByText(
          hasText(
            fill(catalog.budgets.card.remaining, { amount: formatMoney(75000n, 'ARS', locale) }),
          ),
        ),
      ).toBeDefined();
      expect(
        within(card).getByText(
          hasText(catalog.budgets.card.percentage.replace(/\{[^}]*\}\}?/, percent(locale, 0.25))),
        ),
      ).toBeDefined();
      expect(
        screen.getByRole('heading', { level: 1, name: catalog.budgets.list.title }),
      ).toBeDefined();
      const month = new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date('2026-10-01T00:00:00Z'));
      expect(
        screen.getByText(month.charAt(0).toLocaleUpperCase(locale) + month.slice(1)),
      ).toBeDefined();
      expect(within(card).getByRole('link').getAttribute('href')).toBe(
        `/${locale}/budgets/${BUDGET_ID}?month=2026-10`,
      );
    },
  );

  it('shows the error with a retry, never the empty state, and retries (AC-02)', async () => {
    const { calls } = stubApi({
      'GET /budgets/spending': [{ status: 500, body: { code: 'INTERNAL' } }, list([spending()])],
    });
    renderApp(<BudgetsContainer />, { locale: 'en' });

    const retry = await screen.findByRole('button', { name: en.budgets.list.retry });
    expect(screen.queryByText(en.budgets.list.empty.title)).toBeNull();
    await userEvent.setup().click(retry);

    expect(await screen.findByRole('listitem', { name: 'Food' })).toBeDefined();
    expect(calls.filter((c) => c.path === '/budgets/spending')).toHaveLength(2);
  });

  it('draws a marker at each threshold with its label (AC-03)', async () => {
    stubApi({ 'GET /budgets/spending': list([spending({ thresholds: [80, 100] })]) });
    renderApp(<BudgetsContainer />, { locale: 'en' });

    const card = await screen.findByRole('listitem', { name: 'Food' });
    const markers = within(card).getAllByTestId('budget-marker');
    expect(markers.map((m) => m.getAttribute('style'))).toEqual([
      expect.stringContaining('left: 80%'),
      expect.stringContaining('left: 100%'),
    ]);
    expect(
      within(card).getByText(en.budgets.card.marker.replace(/\{[^}]*\}\}?/, '80%')),
    ).toBeDefined();
    expect(
      within(card).getByText(en.budgets.card.marker.replace(/\{[^}]*\}\}?/, '100%')),
    ).toBeDefined();
  });

  it('shows over budget, the negative amount and a full bar (AC-04)', async () => {
    stubApi({
      'GET /budgets/spending': list([
        spending({ spent: '120000', remaining: '-20000', percentUsed: 120 }),
      ]),
    });
    renderApp(<BudgetsContainer />, { locale: 'en' });

    const card = await screen.findByRole('listitem', { name: 'Food' });
    expect(
      within(card).getByText(
        hasText(fill(en.budgets.card.overBudget, { amount: formatMoney(-20000n, 'ARS', 'en') })),
      ),
    ).toBeDefined();
    expect(within(card).getByTestId('budget-bar-fill').getAttribute('style')).toContain(
      'width: 100%',
    );
  });

  it("shows the API's percentage above 100 (AC-05)", async () => {
    stubApi({
      'GET /budgets/spending': list([
        spending({ spent: '1000000', remaining: '-900000', percentUsed: 1000 }),
      ]),
    });
    renderApp(<BudgetsContainer />, { locale: 'en' });

    const card = await screen.findByRole('listitem', { name: 'Food' });
    expect(
      within(card).getByText(
        hasText(en.budgets.card.percentage.replace(/\{[^}]*\}\}?/, percent('en', 10))),
      ),
    ).toBeDefined();
    expect(within(card).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });

  it('shows the rollover amount only when rollover is on (AC-06)', async () => {
    stubApi({
      'GET /budgets/spending': list([
        spending({
          name: 'With',
          rolloverEnabled: true,
          rolloverAmount: '5000',
          available: '105000',
          remaining: '80000',
        }),
        spending({ budgetId: '4f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a11', name: 'Without' }),
      ]),
    });
    renderApp(<BudgetsContainer />, { locale: 'en' });

    const withRollover = await screen.findByRole('listitem', { name: 'With' });
    expect(
      within(withRollover).getByText(
        hasText(fill(en.budgets.card.rollover, { amount: formatMoney(5000n, 'ARS', 'en') })),
      ),
    ).toBeDefined();
    expect(
      within(withRollover).getByText(
        hasText(
          fill(en.budgets.card.spentOfAvailable, {
            spent: formatMoney(25000n, 'ARS', 'en'),
            available: formatMoney(105000n, 'ARS', 'en'),
          }),
        ),
      ),
    ).toBeDefined();
    const without = screen.getByRole('listitem', { name: 'Without' });
    expect(within(without).queryByText(/carried over/)).toBeNull();
  });

  it('loads an earlier month with 1 request and offers the way back (AC-07, NFR-02)', async () => {
    const { calls } = stubApi({
      'GET /budgets/spending': list([spending()]),
      'GET /budgets/spending?month=2026-09': list(
        [spending({ name: 'September food', month: '2026-09' })],
        '2026-09',
      ),
    });
    renderApp(<BudgetsContainer />, { locale: 'en' });
    await screen.findByRole('listitem', { name: 'Food' });
    expect(calls).toHaveLength(1);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: en.budgets.list.month.previous }));

    expect(await screen.findByRole('listitem', { name: 'September food' })).toBeDefined();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.path).toBe('/budgets/spending?month=2026-09');
    expect(screen.getByText('September 2026')).toBeDefined();
  });

  it('going forward to the current month sends no month (D4)', async () => {
    const { calls } = stubApi({
      'GET /budgets/spending': list([spending()]),
      'GET /budgets/spending?month=2026-09': list(
        [spending({ name: 'September food' })],
        '2026-09',
      ),
    });
    renderApp(<BudgetsContainer />, { locale: 'en' });
    await screen.findByRole('listitem', { name: 'Food' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: en.budgets.list.month.previous }));
    await screen.findByRole('listitem', { name: 'September food' });
    await user.click(screen.getByRole('button', { name: en.budgets.list.month.next }));

    expect(await screen.findByRole('listitem', { name: 'Food' })).toBeDefined();
    expect(calls.map((c) => c.path)).toEqual([
      '/budgets/spending',
      '/budgets/spending?month=2026-09',
      '/budgets/spending',
    ]);
  });

  it('has no next action on the current month (AC-08)', async () => {
    stubApi({ 'GET /budgets/spending': list([spending()]) });
    renderApp(<BudgetsContainer />, { locale: 'en' });

    await screen.findByRole('listitem', { name: 'Food' });
    expect(screen.queryByRole('button', { name: en.budgets.list.month.next })).toBeNull();
    expect(screen.getByRole('button', { name: en.budgets.list.month.previous })).toBeDefined();
  });

  it('shows the refusal of a future month and returns to the current month (AC-09)', async () => {
    const { calls } = stubApi({
      'GET /budgets/spending': list([spending()]),
      'GET /budgets/spending?month=2026-09': {
        status: 400,
        body: { code: 'BUDGET_MONTH_IN_FUTURE' },
      },
    });
    renderApp(<BudgetsContainer />, { locale: 'en' });
    await screen.findByRole('listitem', { name: 'Food' });

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: en.budgets.list.month.previous }));

    expect(await screen.findByText(en.errors.budgetMonthInFuture)).toBeDefined();
    expect(await screen.findByRole('listitem', { name: 'Food' })).toBeDefined();
    expect(calls.map((c) => c.path)).toEqual([
      '/budgets/spending',
      '/budgets/spending?month=2026-09',
      '/budgets/spending',
    ]);
    expect(screen.queryByRole('button', { name: en.budgets.list.month.next })).toBeNull();
  });

  it('shows the empty state with the create action when there are no budgets (AC-10)', async () => {
    stubApi({ 'GET /budgets/spending': list([]) });
    renderApp(<BudgetsContainer />, { locale: 'en' });

    expect(await screen.findByRole('heading', { name: en.budgets.list.empty.title })).toBeDefined();
    expect(
      screen.getByRole('link', { name: en.budgets.list.empty.action }).getAttribute('href'),
    ).toBe('/en/budgets/new');
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('shows the unconverted shares notice with its count and none at 0 (AC-13, AC-14)', async () => {
    stubApi({
      'GET /budgets/spending': list([
        spending({ name: 'Some', unconvertedShareCount: 2 }),
        spending({ budgetId: '4f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a11', name: 'None' }),
      ]),
    });
    renderApp(<BudgetsContainer />, { locale: 'en' });

    const some = await screen.findByRole('listitem', { name: 'Some' });
    expect(within(some).getByText(/2 group shares could not be converted/)).toBeDefined();
    const none = screen.getByRole('listitem', { name: 'None' });
    expect(within(none).queryByText(/could not be converted/)).toBeNull();
  });

  it('loads an earlier month from the query after the current one (query month)', async () => {
    const { calls } = stubApi({
      'GET /budgets/spending': list([spending()]),
      'GET /budgets/spending?month=2026-08': list(
        [spending({ name: 'August food', month: '2026-08' })],
        '2026-08',
      ),
    });
    renderApp(<BudgetsContainer />, { locale: 'en', search: 'month=2026-08' });

    expect(await screen.findByRole('listitem', { name: 'August food' })).toBeDefined();
    expect(calls.map((c) => c.path)).toEqual([
      '/budgets/spending',
      '/budgets/spending?month=2026-08',
    ]);
  });

  it.each(['2026-13', 'october', '2026-10-01', '2027-01'])(
    'ignores the query month %s and loads the current month (invalid input)',
    async (month) => {
      const { calls } = stubApi({ 'GET /budgets/spending': list([spending()]) });
      renderApp(<BudgetsContainer />, { locale: 'en', search: `month=${month}` });

      expect(await screen.findByRole('listitem', { name: 'Food' })).toBeDefined();
      expect(calls.map((c) => c.path)).toEqual(['/budgets/spending']);
      expect(screen.queryByRole('button', { name: en.budgets.list.month.next })).toBeNull();
    },
  );

  it('shows the offline message on a network failure (AC-29)', async () => {
    stubApi({ 'GET /budgets/spending': 'network-error' });
    renderApp(<BudgetsContainer />, { locale: 'en' });

    expect(await screen.findByText(en.errors.network)).toBeDefined();
    expect(screen.queryByText(en.budgets.list.empty.title)).toBeNull();
  });

  it('capitalises only the first letter of the Spanish month label (L2)', async () => {
    stubApi({ 'GET /budgets/spending': list([spending()]) });
    renderApp(<BudgetsContainer />, { locale: 'es' });

    const label = await screen.findByText('Octubre de 2026');
    expect(label.className).not.toContain('capitalize');
  });

  it('sends a signed-out user to sign in (sad path)', async () => {
    stubApi({ 'GET /budgets/spending': { status: 401, body: { code: 'UNAUTHENTICATED' } } });
    const { router } = renderApp(<BudgetsContainer />, { locale: 'en' });
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/sign-in');
    });
  });

  it('has 44 px targets, labeled month actions and a labeled bar (NFR-06)', async () => {
    stubApi({ 'GET /budgets/spending': list([spending()]) });
    renderApp(<BudgetsContainer />, { locale: 'en' });

    const card = await screen.findByRole('listitem', { name: 'Food' });
    expect(within(card).getByRole('link').className).toMatch(/\bmin-h-11\b/);
    expect(screen.getByRole('link', { name: en.budgets.list.create }).className).toMatch(
      /\bmin-h-11\b/,
    );
    expect(screen.getByRole('button', { name: en.budgets.list.month.previous }).className).toMatch(
      /\bsize-11\b/,
    );
    expect(within(card).getByRole('progressbar').getAttribute('aria-label')).toBeTruthy();
  });
});

describe('BudgetProgress', () => {
  it('renders a bar with the figures from a view (FR-02)', () => {
    renderApp(<BudgetProgress view={toBudgetView(spending())} />, { locale: 'en' });
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getAllByTestId('budget-marker')).toHaveLength(2);
  });
});

describe('UnconvertedNotice', () => {
  it('renders nothing for a count of 0 and the count otherwise (AC-13, AC-14)', () => {
    const { rerender, container } = renderApp(<UnconvertedNotice count={0} />, { locale: 'es' });
    expect(container.textContent).toBe('');
    rerender(<UnconvertedNotice count={1} />);
    expect(screen.getByText(/1 parte de grupo/)).toBeDefined();
  });
});
