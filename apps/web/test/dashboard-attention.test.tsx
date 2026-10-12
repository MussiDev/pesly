// @vitest-environment happy-dom
import { renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAttentionItems,
  type QueueAttention,
} from '../src/features/dashboard/attention/attention-items';
import { useQueueAttention } from '../src/features/dashboard/attention/use-queue-attention';
import { DoTheseFirst } from '../src/features/dashboard/components/do-these-first';
import { InsightCard } from '../src/features/dashboard/components/insight-card';
import type { ActionView } from '../src/features/dashboard/dashboard-view';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const readQueueCounts = vi.hoisted(() => vi.fn());
const readGroupQueueCounts = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/local-store/device-copy', () => ({ readQueueCounts }));
vi.mock('../src/lib/sync/group-queue-counts', () => ({ readGroupQueueCounts }));

const { en, es } = CATALOGS;
const NONE: QueueAttention = { failedMovements: 0, failedGroupChanges: 0, groupConflicts: 0 };

function action(overrides: Partial<ActionView>): ActionView {
  return {
    kind: 'pending_occurrence',
    href: '/recurring/p-1',
    overdue: false,
    name: 'Rent',
    date: '2026-10-05',
    amount: 3500000n,
    currency: 'ARS',
    ...overrides,
  };
}

const OVERDUE = action({
  kind: 'overdue_occurrence',
  overdue: true,
  name: 'Gym',
  href: '/recurring/p-2',
  date: '2026-09-20',
});
const PENDING = action({});
const STATEMENT = action({
  kind: 'statement',
  name: 'Visa',
  href: '/cards/c-1',
  date: '2026-10-18',
});

beforeEach(() => {
  readQueueCounts.mockReset();
  readGroupQueueCounts.mockReset();
  readQueueCounts.mockResolvedValue({ pending: 0, failed: 0 });
  readGroupQueueCounts.mockResolvedValue({ pending: 0, failed: 0, conflict: 0 });
});

describe('buildAttentionItems', () => {
  it('keeps the server order and appends one item per non-zero queue count', () => {
    const items = buildAttentionItems([OVERDUE, PENDING], {
      failedMovements: 2,
      failedGroupChanges: 0,
      groupConflicts: 1,
    });
    expect(items.map((item) => item.href)).toEqual([
      '/recurring/p-2',
      '/recurring/p-1',
      '/movements',
      '/groups',
    ]);
  });

  it('returns nothing for no action and an empty queue', () => {
    expect(buildAttentionItems([], NONE)).toEqual([]);
  });

  it('adds at most three queue items', () => {
    const items = buildAttentionItems([], {
      failedMovements: 1,
      failedGroupChanges: 1,
      groupConflicts: 1,
    });
    expect(items).toHaveLength(3);
  });
});

describe('DoTheseFirst', () => {
  it('lists the overdue item first, each linking where it is resolved (AC-21)', () => {
    const items = buildAttentionItems([OVERDUE, PENDING, STATEMENT], NONE);
    renderApp(<DoTheseFirst locale="en" items={items} />, { locale: 'en' });
    expect(screen.getByText(en.dashboard.attention.title)).toBeDefined();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/en/recurring/p-2',
      '/en/recurring/p-1',
      '/en/cards/c-1',
    ]);
    expect(links[0]?.textContent).toContain(en.dashboard.attention.overdueOccurrence);
    expect(links[0]?.textContent).toContain('Gym');
    expect(links[0]?.textContent).toContain(en.dashboard.attention.overdue);
    expect(links[2]?.textContent).toContain(en.dashboard.attention.statementDue);
  });

  it('renders no title and no list for an empty list (AC-22)', () => {
    const { container } = renderApp(<DoTheseFirst locale="en" items={[]} />, { locale: 'en' });
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('lists 2 failed movements and 1 group conflict with their links (AC-23)', () => {
    const items = buildAttentionItems([], {
      failedMovements: 2,
      failedGroupChanges: 0,
      groupConflicts: 1,
    });
    renderApp(<DoTheseFirst locale="en" items={items} />, { locale: 'en' });
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/en/movements', '/en/groups']);
    expect(links[0]?.textContent).toBe('2 movements failed to sync');
    expect(links[1]?.textContent).toBe('1 group conflict to resolve');
  });

  it('uses the generic label and a link for an unknown action kind', () => {
    const items = buildAttentionItems(
      [
        action({
          kind: 'weird-new-kind',
          href: '/recurring',
          name: null,
          date: null,
          amount: null,
        }),
      ],
      NONE,
    );
    renderApp(<DoTheseFirst locale="en" items={items} />, { locale: 'en' });
    const link = screen.getByRole('link', { name: new RegExp(en.dashboard.attention.unknown) });
    expect(link.getAttribute('href')).toBe('/en/recurring');
  });

  it('gives every item a 44 px target class and an accessible name', () => {
    const items = buildAttentionItems([PENDING], { ...NONE, failedMovements: 1 });
    renderApp(<DoTheseFirst locale="en" items={items} />, { locale: 'en' });
    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toContain('min-h-11');
      expect(link.textContent.length).toBeGreaterThan(0);
    }
  });

  it('renders Spanish labels, dates and amounts', () => {
    const items = buildAttentionItems([PENDING], { ...NONE, failedGroupChanges: 3 });
    renderApp(<DoTheseFirst locale="es" items={items} />, { locale: 'es' });
    expect(screen.getByText(es.dashboard.attention.title)).toBeDefined();
    const links = screen.getAllByRole('link');
    expect(links[0]?.textContent).toContain(es.dashboard.attention.pendingOccurrence);
    expect(links[0]?.textContent).toContain('35.000,00');
    expect(links[1]?.textContent).toContain('3 cambios de grupo');
  });
});

describe('useQueueAttention', () => {
  it('reads both counters and becomes ready', async () => {
    readQueueCounts.mockResolvedValue({ pending: 0, failed: 2 });
    readGroupQueueCounts.mockResolvedValue({ pending: 0, failed: 1, conflict: 4 });
    const { result } = renderHook(() => useQueueAttention());
    expect(result.current.ready).toBe(false);
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.queue).toEqual({
      failedMovements: 2,
      failedGroupChanges: 1,
      groupConflicts: 4,
    });
  });

  it('counts an unreadable queue as empty and is still ready', async () => {
    readQueueCounts.mockRejectedValue(new Error('idb'));
    readGroupQueueCounts.mockRejectedValue(new Error('idb'));
    const { result } = renderHook(() => useQueueAttention());
    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });
    expect(result.current.queue).toEqual(NONE);
  });

  it('lists the queue items offline and sends no request (AC-24)', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    readQueueCounts.mockResolvedValue({ pending: 0, failed: 2 });
    const { fetch } = stubApi({});
    function Harness() {
      const { queue } = useQueueAttention();
      return <DoTheseFirst locale="en" items={buildAttentionItems([], queue)} />;
    }
    renderApp(<Harness />, { locale: 'en' });
    expect(await screen.findByText('2 movements failed to sync')).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });
});

describe('InsightCard', () => {
  it('states the share and the change above the average (AC-26)', () => {
    renderApp(
      <InsightCard locale="en" insight={{ label: 'Restaurants', share: 32, change: 40 }} />,
      { locale: 'en' },
    );
    expect(
      screen.getByText(
        'Restaurants is 32% of your spending, 40% above the average of the previous 3 months.',
      ),
    ).toBeDefined();
  });

  it('says below for a negative change', () => {
    renderApp(<InsightCard locale="en" insight={{ label: 'Food', share: 10, change: -15 }} />, {
      locale: 'en',
    });
    expect(screen.getByText(/15% below the average/)).toBeDefined();
  });

  it('says in line for a change of exactly 0', () => {
    renderApp(<InsightCard locale="en" insight={{ label: 'Food', share: 10, change: 0 }} />, {
      locale: 'en',
    });
    expect(screen.getByText(/in line with the average/)).toBeDefined();
    expect(screen.queryByText(/0% above/)).toBeNull();
  });

  it('keeps the share only for a null change (AC-27)', () => {
    renderApp(
      <InsightCard locale="en" insight={{ label: 'Restaurants', share: 32, change: null }} />,
      { locale: 'en' },
    );
    expect(screen.getByText('Restaurants is 32% of your spending this month.')).toBeDefined();
  });

  it('renders nothing for a null insight (AC-28)', () => {
    const { container } = renderApp(<InsightCard locale="en" insight={null} />, { locale: 'en' });
    expect(container.textContent).toBe('');
  });

  it('renders the Spanish sentence with both numbers', () => {
    renderApp(
      <InsightCard locale="es" insight={{ label: 'Restaurantes', share: 32, change: 40 }} />,
      { locale: 'es' },
    );
    const sentence = screen.getByText(/Restaurantes/);
    expect(sentence.textContent).toContain('32%');
    expect(sentence.textContent).toContain('40%');
  });
});
