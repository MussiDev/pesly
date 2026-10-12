// @vitest-environment happy-dom
import { formatMoney, type GoalResponse } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { GoalsContainer } from '../src/features/goals/list/goals-container';
import { GoalsList } from '../src/features/goals/list/goals-list';
import { toGoalView } from '../src/features/goals/helpers/goal-view';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;

const GOAL_ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';

function goal(overrides: Partial<GoalResponse> = {}): GoalResponse {
  return {
    id: GOAL_ID,
    name: 'Trip',
    targetAmount: '100000',
    currency: 'ARS',
    targetDate: null,
    accountId: null,
    progress: '25000',
    percentage: 25,
    status: 'active',
    monthlyAmountNeeded: null,
    createdAt: '2026-10-06T12:00:00.000Z',
    ...overrides,
  };
}

// Amounts join the currency with a non-breaking space, so compare with whitespace flattened.
const flat = (text: string) => text.replace(/\s+/g, ' ');
const hasText = (expected: string) => (content: string) => flat(content).includes(flat(expected));

const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template);

describe('GoalsContainer', () => {
  it.each([
    ['es', es],
    ['en', en],
  ] as const)(
    'shows name, progress, target, currency, percentage and a bar per goal (%s, AC-01, AC-29)',
    async (locale, catalog) => {
      stubApi({ 'GET /goals': { status: 200, body: { goals: [goal()] } } });
      renderApp(<GoalsContainer />, { locale });

      const card = await screen.findByRole('listitem', { name: 'Trip' });
      expect(
        within(card).getByText(
          hasText(
            fill(catalog.goals.card.progressOfTarget, {
              saved: formatMoney(25000n, 'ARS', locale),
              target: formatMoney(100000n, 'ARS', locale),
            }),
          ),
        ),
      ).toBeDefined();
      const percentText = new Intl.NumberFormat(locale, { style: 'percent' }).format(0.25);
      expect(
        within(card).getByText(
          hasText(catalog.goals.card.percentage.replace(/\{[^}]*\}\}?/, percentText)),
        ),
      ).toBeDefined();
      const bar = within(card).getByRole('progressbar');
      expect(bar.getAttribute('aria-label')).toBeTruthy();
      expect(bar.getAttribute('aria-valuenow')).toBe('25');
      expect(within(card).getByRole('link').getAttribute('href')).toBe(
        `/${locale}/goals/${GOAL_ID}`,
      );
    },
  );

  it('shows the negative progress, 0% and an empty bar for an overdrawn linked goal (AC-02)', async () => {
    stubApi({
      'GET /goals': {
        status: 200,
        body: {
          goals: [
            goal({
              accountId: '11111111-1111-4111-8111-111111111111',
              progress: '-5000',
              percentage: 0,
            }),
          ],
        },
      },
    });
    renderApp(<GoalsContainer />, { locale: 'en' });

    const card = await screen.findByRole('listitem', { name: 'Trip' });
    expect(within(card).getByText(hasText(formatMoney(-5000n, 'ARS', 'en')))).toBeDefined();
    expect(within(card).getByText(/0%/)).toBeDefined();
    const bar = within(card).getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(within(card).getByTestId('goal-bar-fill').getAttribute('style')).toContain('width: 0%');
  });

  it('shows the monthly amount as returned for a goal with a target date (AC-03)', async () => {
    stubApi({
      'GET /goals': {
        status: 200,
        body: { goals: [goal({ targetDate: '2027-06-01', monthlyAmountNeeded: '12500' })] },
      },
    });
    renderApp(<GoalsContainer />, { locale: 'en' });

    const card = await screen.findByRole('listitem', { name: 'Trip' });
    expect(
      within(card).getByText(
        hasText(fill(en.goals.card.monthlyNeeded, { amount: formatMoney(12500n, 'ARS', 'en') })),
      ),
    ).toBeDefined();
  });

  it('shows reached and no monthly amount for a reached goal (AC-04)', async () => {
    stubApi({
      'GET /goals': {
        status: 200,
        body: {
          goals: [
            goal({
              status: 'reached',
              progress: '100000',
              percentage: 100,
              targetDate: '2027-06-01',
              monthlyAmountNeeded: null,
            }),
          ],
        },
      },
    });
    renderApp(<GoalsContainer />, { locale: 'en' });

    const card = await screen.findByRole('listitem', { name: 'Trip' });
    expect(within(card).getByText(en.goals.card.reached)).toBeDefined();
    expect(within(card).queryByText(/per month needed/)).toBeNull();
  });

  it('shows overdue instead of a monthly amount for an overdue goal (AC-05)', async () => {
    stubApi({
      'GET /goals': {
        status: 200,
        body: { goals: [goal({ status: 'overdue', targetDate: '2026-01-01' })] },
      },
    });
    renderApp(<GoalsContainer />, { locale: 'es' });

    const card = await screen.findByRole('listitem', { name: 'Trip' });
    expect(within(card).getByText(es.goals.card.overdue)).toBeDefined();
    expect(within(card).queryByText(/al mes/)).toBeNull();
  });

  it('shows the empty state with the create action when there are no goals (AC-06)', async () => {
    stubApi({ 'GET /goals': { status: 200, body: { goals: [] } } });
    renderApp(<GoalsContainer />, { locale: 'en' });

    expect(await screen.findByRole('heading', { name: en.goals.list.empty.title })).toBeDefined();
    const create = screen.getByRole('link', { name: en.goals.list.empty.action });
    expect(create.getAttribute('href')).toBe('/en/goals/new');
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('shows the error with a retry, never the empty state, and retries (AC-07)', async () => {
    const { calls } = stubApi({
      'GET /goals': [
        { status: 500, body: { code: 'INTERNAL' } },
        { status: 200, body: { goals: [goal()] } },
      ],
    });
    renderApp(<GoalsContainer />, { locale: 'en' });

    const retry = await screen.findByRole('button', { name: en.goals.list.retry });
    expect(screen.queryByText(en.goals.list.empty.title)).toBeNull();
    await userEvent.setup().click(retry);

    expect(await screen.findByRole('listitem', { name: 'Trip' })).toBeDefined();
    expect(calls.filter((c) => c.path === '/goals')).toHaveLength(2);
  });

  it('shows the offline message on a network failure (AC-28)', async () => {
    stubApi({ 'GET /goals': 'network-error' });
    renderApp(<GoalsContainer />, { locale: 'en' });

    expect(await screen.findByText(en.errors.network)).toBeDefined();
    expect(screen.queryByText(en.goals.list.empty.title)).toBeNull();
  });

  it('sends a signed-out user to sign in (sad path)', async () => {
    stubApi({ 'GET /goals': { status: 401, body: { code: 'UNAUTHENTICATED' } } });
    const { router } = renderApp(<GoalsContainer />, { locale: 'en' });
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/sign-in');
    });
  });

  it('makes exactly 1 request (NFR-02)', async () => {
    const { calls } = stubApi({
      'GET /goals': {
        status: 200,
        body: {
          goals: [goal(), goal({ id: '4f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a11', name: 'Car' })],
        },
      },
    });
    renderApp(<GoalsContainer />, { locale: 'en' });

    await screen.findByRole('listitem', { name: 'Car' });
    expect(calls).toHaveLength(1);
  });

  it('has 44 px targets and a labeled bar (NFR-06)', async () => {
    stubApi({ 'GET /goals': { status: 200, body: { goals: [goal()] } } });
    renderApp(<GoalsContainer />, { locale: 'en' });

    const card = await screen.findByRole('listitem', { name: 'Trip' });
    expect(within(card).getByRole('link').className).toMatch(/\bmin-h-11\b/);
    expect(screen.getByRole('link', { name: en.goals.list.create }).className).toMatch(
      /\bmin-h-11\b/,
    );
    expect(within(card).getByRole('progressbar').getAttribute('aria-label')).toBeTruthy();
  });
});

describe('GoalsList', () => {
  it('renders the title and the create action in the header (FR-02)', () => {
    renderApp(<GoalsList goals={[toGoalView(goal())]} />, { locale: 'en' });
    expect(screen.getByRole('heading', { level: 1, name: en.goals.list.title })).toBeDefined();
    expect(screen.getByRole('link', { name: en.goals.list.create }).getAttribute('href')).toBe(
      '/en/goals/new',
    );
  });
});
