// @vitest-environment happy-dom
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CategorySummaryContainer } from '../src/features/groups/category-views/summary-container';
import type { SummaryView } from '../src/features/groups/category-views/types';
import { formatMoney } from '../src/lib/format-amount';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const GROUP_ID = '55555555-5555-4555-8555-555555555555';
const FOOD = '66666666-6666-4666-8666-666666666661';
const RENT = '66666666-6666-4666-8666-666666666662';
const OLD = '66666666-6666-4666-8666-666666666663';
const GONE_A = '66666666-6666-4666-8666-666666666664';
const GONE_B = '66666666-6666-4666-8666-666666666665';

const OCT = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T23:59:59.999Z' };
const SEP = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-30T23:59:59.999Z' };

const flat = (value: string) => value.replace(/\s/g, ' ');
const hasText = (expected: string) => (content: string) => flat(content) === flat(expected);

const summaryKey = (range: { from: string; to: string }) =>
  `GET /groups/${GROUP_ID}/expenses/summary?${new URLSearchParams(range).toString()}`;

const category = (
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  defaultKey: null,
  name,
  icon: 'utensils',
  color: 'orange',
  archivedAt: null,
  ...overrides,
});

const answer = (range: { from: string; to: string }, overrides: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    ...range,
    currencies: [
      {
        currency: 'ARS',
        total: '1000000',
        count: 5,
        categories: [
          { categoryId: FOOD, total: '700000', count: 3 },
          { categoryId: RENT, total: '300000', count: 2 },
        ],
      },
      {
        currency: 'USD',
        total: '5000',
        count: 1,
        categories: [{ categoryId: FOOD, total: '5000', count: 1 }],
      },
    ],
    categories: [category(FOOD, 'Groceries'), category(RENT, 'Rent', { icon: 'home' })],
    ...overrides,
  },
});

function mount(
  props: Partial<Parameters<typeof CategorySummaryContainer>[0]> = {},
  locale: 'en' | 'es' = 'en',
) {
  const onSelectCategory = vi.fn();
  const onLoaded = vi.fn();
  const ui = (range: { from: string; to: string }) => (
    <CategorySummaryContainer
      groupId={GROUP_ID}
      range={range}
      selectedCategoryIds={[]}
      onSelectCategory={onSelectCategory}
      onLoaded={onLoaded}
      {...props}
    />
  );
  const rendered = renderApp(ui(props.range ?? OCT), { locale });
  return { ...rendered, ui, onSelectCategory, onLoaded };
}

describe('CategorySummaryContainer', () => {
  it('makes exactly 1 request on load and 1 on a month change', async () => {
    const { calls } = stubApi({
      [summaryKey(OCT)]: answer(OCT),
      [summaryKey(SEP)]: answer(SEP),
    });
    const { rerender, ui } = mount();
    await screen.findAllByText('Groceries');
    expect(calls).toHaveLength(1);
    rerender(ui(SEP));
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1]?.path).toContain('2026-09-01');
    await act(() => Promise.resolve());
    expect(calls).toHaveLength(2);
  });

  it('shows one list per currency with its own total and no summed amount', async () => {
    stubApi({ [summaryKey(OCT)]: answer(OCT) });
    mount();
    await screen.findByText('Rent');
    const sections = screen.getAllByRole('list');
    expect(sections).toHaveLength(2);
    expect(screen.getByText(hasText(formatMoney(1000000n, 'ARS', 'en')))).toBeTruthy();
    expect(screen.getAllByText(hasText(formatMoney(5000n, 'USD', 'en'))).length).toBeGreaterThan(0);
    expect(screen.queryByText(hasText(formatMoney(1005000n, 'ARS', 'en')))).toBeNull();
    expect(screen.queryByText(hasText(formatMoney(1005000n, 'USD', 'en')))).toBeNull();
  });

  it('lists the lines in the view order with amount and percentage as text', async () => {
    stubApi({ [summaryKey(OCT)]: answer(OCT) });
    mount();
    await screen.findByText('Rent');
    const [ars] = screen.getAllByRole('list');
    if (!ars) throw new Error('no list');
    const rows = within(ars).getAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('Groceries');
    expect(flat(rows[0]?.textContent ?? '')).toContain(flat(formatMoney(700000n, 'ARS', 'en')));
    expect(rows[0]?.textContent).toContain('70%');
    expect(rows[1]?.textContent).toContain('Rent');
    expect(rows[1]?.textContent).toContain('30%');
  });

  it('shows the archived marker and merges an unknown category into "No category"', async () => {
    stubApi({
      [summaryKey(OCT)]: {
        status: 200,
        body: {
          ...OCT,
          currencies: [
            {
              currency: 'ARS',
              total: '1000',
              count: 4,
              categories: [
                { categoryId: OLD, total: '500', count: 1 },
                { categoryId: GONE_A, total: '300', count: 2 },
                { categoryId: GONE_B, total: '200', count: 1 },
              ],
            },
          ],
          categories: [category(OLD, 'Gym', { archivedAt: '2026-09-01T00:00:00.000Z' })],
        },
      },
    });
    const { onLoaded, onSelectCategory } = mount();
    const gym = (await screen.findByText('Gym')).closest('li');
    if (!gym) throw new Error('no row');
    expect(within(gym).getByText(en.groups.categoryViews.chip.archived)).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const merged = screen.getByText(en.groups.expenses.uncategorized).closest('li');
    if (!merged) throw new Error('no merged row');
    expect(flat(merged.textContent)).toContain(flat(formatMoney(500n, 'ARS', 'en')));
    expect(screen.queryByText(GONE_A)).toBeNull();
    const view = onLoaded.mock.calls[0]?.[0] as SummaryView;
    expect(view.currencies[0]?.lines).toHaveLength(2);
    await userEvent.click(within(merged).getByRole('button'));
    expect(onSelectCategory).toHaveBeenCalledWith([GONE_A, GONE_B]);
  });

  it('shows the month-empty state when there are no expenses', async () => {
    stubApi({ [summaryKey(OCT)]: answer(OCT, { currencies: [], categories: [] }) });
    mount();
    expect(
      await screen.findByText(en.groups.categoryViews.summarySection.empty.title),
    ).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('calls onSelectCategory with the ids of the tapped line and reports the view', async () => {
    stubApi({ [summaryKey(OCT)]: answer(OCT) });
    const { onSelectCategory, onLoaded } = mount();
    const rent = (await screen.findByText('Rent')).closest('button');
    if (!rent) throw new Error('no button');
    await userEvent.click(rent);
    expect(onSelectCategory).toHaveBeenCalledWith([RENT]);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    const view = onLoaded.mock.calls[0]?.[0] as SummaryView;
    expect(view.currencies.map((entry) => entry.currency)).toEqual(['ARS', 'USD']);
  });

  it('marks the selected lines with a text marker', async () => {
    stubApi({ [summaryKey(OCT)]: answer(OCT) });
    mount({ selectedCategoryIds: [RENT] });
    await screen.findByText('Rent');
    const marker = screen.getByText(
      en.groups.categoryViews.summarySection.selected.replace('{names}', 'Rent'),
    );
    expect(marker).toBeTruthy();
  });

  it('does not show the previous month lines while the new month loads', async () => {
    let releaseSep: (response: Response) => void = () => undefined;
    const sepAnswer = new Promise<Response>((resolve) => {
      releaseSep = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('2026-09-01')
          ? sepAnswer
          : Promise.resolve(
              new Response(JSON.stringify(answer(OCT).body), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            ),
      ),
    );
    const { rerender, ui } = mount();
    await screen.findByText('Rent');
    rerender(ui(SEP));
    expect(screen.queryByRole('button', { name: /Rent/ })).toBeNull();
    expect(screen.queryByText('Rent')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
    await act(async () => {
      releaseSep(
        new Response(JSON.stringify(answer(SEP).body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });
    expect(await screen.findByText('Rent')).toBeTruthy();
  });

  it('exposes aria-pressed on each line button', async () => {
    stubApi({ [summaryKey(OCT)]: answer(OCT) });
    mount({ selectedCategoryIds: [RENT] });
    await screen.findByText('Rent');
    expect(screen.getByRole('button', { name: /Rent/ }).getAttribute('aria-pressed')).toBe('true');
    for (const button of screen.getAllByRole('button', { name: /Groceries/ })) {
      expect(button.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('shows the error with a retry that requests again, once per click', async () => {
    const { calls } = stubApi({
      [summaryKey(OCT)]: [{ status: 500, body: { code: 'INTERNAL' } }, answer(OCT)],
    });
    mount();
    const retry = await screen.findByRole('button', { name: en.app.retry });
    expect(screen.queryByText('Groceries')).toBeNull();
    await userEvent.click(retry);
    expect((await screen.findAllByText('Groceries')).length).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
  });

  it('shows not-found on a 404', async () => {
    stubApi({ [summaryKey(OCT)]: { status: 404, body: { code: 'NOT_FOUND' } } });
    mount();
    expect(await screen.findByText(en.groups.detail.notFound.title)).toBeTruthy();
  });

  it('goes to sign-in on a 401', async () => {
    stubApi({
      [summaryKey(OCT)]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
      'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
    });
    const { router } = mount();
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/sign-in');
    });
  });

  it('shows not-found for a malformed group id and sends no request', () => {
    const { calls } = stubApi({});
    mount({ groupId: 'not-a-uuid' });
    expect(screen.getByText(en.groups.detail.notFound.title)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('drops an answer for an older month that arrives late', async () => {
    let releaseOct: (response: Response) => void = () => undefined;
    const octAnswer = new Promise<Response>((resolve) => {
      releaseOct = resolve;
    });
    const septemberBody = answer(SEP, {
      categories: [category(FOOD, 'September food')],
      currencies: [
        {
          currency: 'ARS',
          total: '100',
          count: 1,
          categories: [{ categoryId: FOOD, total: '100', count: 1 }],
        },
      ],
    }).body;
    const fetch = vi.fn((url: string) =>
      url.includes('2026-10-01')
        ? octAnswer
        : Promise.resolve(
            new Response(JSON.stringify(septemberBody), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
    );
    vi.stubGlobal('fetch', fetch);
    const { rerender, ui } = mount();
    rerender(ui(SEP));
    expect(await screen.findByText('September food')).toBeTruthy();
    await act(async () => {
      releaseOct(
        new Response(JSON.stringify(answer(OCT).body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });
    expect(screen.getByText('September food')).toBeTruthy();
    expect(screen.queryByText('Rent')).toBeNull();
  });

  it('renders in Spanish and English with the locale percent and no hardcoded string', async () => {
    stubApi({ [summaryKey(OCT)]: answer(OCT) });
    mount({}, 'es');
    await screen.findByText('Rent');
    expect(
      screen.getByRole('heading', { name: es.groups.categoryViews.summarySection.title }),
    ).toBeTruthy();
    expect(screen.getAllByText(/70\s?%/).length).toBeGreaterThan(0);
  });
});
