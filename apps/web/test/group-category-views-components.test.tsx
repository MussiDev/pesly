// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActiveFilterChips } from '../src/features/groups/category-views/components/active-filter-chips';
import { CategoryChip } from '../src/features/groups/category-views/components/category-chip';
import { CategoryFilter } from '../src/features/groups/category-views/components/category-filter';
import { CategorySummary } from '../src/features/groups/category-views/components/category-summary';
import { MonthPicker } from '../src/features/groups/category-views/components/month-picker';
import type { CategoryDisplay, SummaryView } from '../src/features/groups/category-views/types';
import { CATALOGS, renderApp } from './support/render-app';

const { en, es } = CATALOGS;

const display = (id: string, overrides: Partial<CategoryDisplay> = {}): CategoryDisplay => ({
  id,
  label: 'Food',
  icon: 'utensils',
  color: 'orange',
  archived: false,
  known: true,
  ...overrides,
});

const FOOD = display('food');
const TRIP = display('trip', { label: 'Trip', icon: 'plane', color: 'blue' });
const OLD = display('old', { label: 'Old', archived: true });

describe('CategoryChip', () => {
  it('shows the icon, the color and the name as text', () => {
    const { container } = renderApp(<CategoryChip display={FOOD} />, { locale: 'en' });
    expect(screen.getByText('Food')).toBeTruthy();
    const visual = container.querySelector('[data-icon]');
    expect(visual?.getAttribute('data-icon')).toBe('utensils');
    expect(visual?.getAttribute('data-color')).toBe('orange');
    expect(screen.queryByText(en.groups.categoryViews.chip.archived)).toBeNull();
  });

  it('marks an archived category with text and an icon', () => {
    const { container } = renderApp(<CategoryChip display={OLD} />, { locale: 'en' });
    expect(screen.getByText(en.groups.categoryViews.chip.archived)).toBeTruthy();
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
  });

  it('renders the neutral fallback with the label and never the raw id', () => {
    const unknown = display('0b1c2d3e-aaaa-4bbb-8ccc-123456789012', {
      label: 'No category',
      icon: 'unknown',
      color: 'neutral',
      known: false,
    });
    const { container } = renderApp(<CategoryChip display={unknown} />, { locale: 'en' });
    expect(screen.getByText('No category')).toBeTruthy();
    expect(container.textContent).not.toContain('0b1c2d3e');
    expect(container.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe('unknown');
    expect(container.querySelector('[data-color]')?.getAttribute('data-color')).toBe('unknown');
  });

  it('renders a name with markup as literal text', () => {
    const evil = display('x', { label: '<img src=x onerror=alert(1)>' });
    const { container } = renderApp(<CategoryChip display={evil} />, { locale: 'en' });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });
});

describe('CategoryFilter', () => {
  it('toggles categories through the callback and marks the active ones', async () => {
    const onToggle = vi.fn();
    renderApp(<CategoryFilter options={[FOOD, TRIP]} selected={['trip']} onToggle={onToggle} />, {
      locale: 'en',
    });
    const food = screen.getByRole('button', { name: /Food/ });
    const trip = screen.getByRole('button', { name: /Trip/ });
    expect(food.getAttribute('aria-pressed')).toBe('false');
    expect(trip.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(food);
    await userEvent.click(trip);
    expect(onToggle).toHaveBeenNthCalledWith(1, 'food');
    expect(onToggle).toHaveBeenNthCalledWith(2, 'trip');
  });
});

describe('ActiveFilterChips', () => {
  it('removes one chip and clears all through their callbacks', async () => {
    const onRemove = vi.fn();
    const onClear = vi.fn();
    renderApp(<ActiveFilterChips selected={[FOOD, TRIP]} onRemove={onRemove} onClear={onClear} />, {
      locale: 'en',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Trip' }));
    expect(onRemove).toHaveBeenCalledWith('trip');
    await userEvent.click(
      screen.getByRole('button', { name: en.groups.categoryViews.filter.clear }),
    );
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when no category is selected', () => {
    const { container } = renderApp(
      <ActiveFilterChips selected={[]} onRemove={vi.fn()} onClear={vi.fn()} />,
    );
    expect(container.textContent).toBe('');
  });
});

describe('MonthPicker', () => {
  const MONTHS = ['2026-10', '2026-09', '2026-08'];
  const labelText = en.groups.categoryViews.month.label;

  it('lists the offered months and nothing in the future', () => {
    renderApp(<MonthPicker months={MONTHS} value="2026-09" onChange={vi.fn()} />, { locale: 'en' });
    const select = screen.getByLabelText(labelText);
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['October 2026', 'September 2026', 'August 2026']);
    expect((select as HTMLSelectElement).value).toBe('2026-09');
  });

  it('changes month from the select and from previous and next', async () => {
    const onChange = vi.fn();
    renderApp(<MonthPicker months={MONTHS} value="2026-09" onChange={onChange} />, {
      locale: 'en',
    });
    await userEvent.click(
      screen.getByRole('button', { name: en.groups.categoryViews.month.previous }),
    );
    await userEvent.click(screen.getByRole('button', { name: en.groups.categoryViews.month.next }));
    expect(onChange).toHaveBeenNthCalledWith(1, '2026-08');
    expect(onChange).toHaveBeenNthCalledWith(2, '2026-10');
    await userEvent.selectOptions(screen.getByLabelText(labelText), '2026-10');
    expect(onChange).toHaveBeenNthCalledWith(3, '2026-10');
  });

  it('disables next at the newest month and previous at the oldest', () => {
    const { rerender } = renderApp(
      <MonthPicker months={MONTHS} value="2026-10" onChange={vi.fn()} />,
      { locale: 'en' },
    );
    const next = () => screen.getByRole('button', { name: en.groups.categoryViews.month.next });
    const previous = () =>
      screen.getByRole('button', { name: en.groups.categoryViews.month.previous });
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    expect((previous() as HTMLButtonElement).disabled).toBe(false);
    rerender(<MonthPicker months={MONTHS} value="2026-08" onChange={vi.fn()} />);
    expect((previous() as HTMLButtonElement).disabled).toBe(true);
    expect((next() as HTMLButtonElement).disabled).toBe(false);
  });
});

const line = (
  key: string,
  shown: CategoryDisplay,
  total: bigint,
  count: number,
  shareBasisPoints: number,
) => ({ key, categoryIds: [key], display: shown, total, count, shareBasisPoints });

describe('CategorySummary', () => {
  it('sets aria-pressed on each line button from selectedCategoryIds, and none without onSelect', () => {
    const first = VIEW.currencies[0]?.lines[0];
    const picked = first?.categoryIds ?? [];
    const { unmount } = renderApp(
      <CategorySummary view={VIEW} onSelect={vi.fn()} selectedCategoryIds={picked} />,
      { locale: 'en' },
    );
    const states = screen.getAllByRole('button').map((b) => b.getAttribute('aria-pressed'));
    expect(states).toContain('true');
    expect(states).toContain('false');
    expect(states.every((state) => state === 'true' || state === 'false')).toBe(true);
    unmount();
    renderApp(<CategorySummary view={VIEW} onSelect={vi.fn()} />, { locale: 'en' });
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('aria-pressed')).toBe('false');
    }
  });

  const VIEW: SummaryView = {
    currencies: [
      {
        currency: 'ARS',
        total: 100000n,
        count: 3,
        lines: [line('food', FOOD, 75000n, 2, 7500), line('trip', TRIP, 25000n, 1, 2500)],
      },
      {
        currency: 'USD',
        total: 5000n,
        count: 1,
        lines: [line('trip', TRIP, 5000n, 1, 10000)],
      },
    ],
  };

  it('shows amount, percentage as text and an aria-hidden bar per line', () => {
    renderApp(<CategorySummary view={VIEW} onSelect={vi.fn()} />, { locale: 'en' });
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(2);
    const first = within(lists[0] as HTMLElement).getAllByRole('listitem')[0] as HTMLElement;
    expect(first.textContent).toContain('Food');
    expect(first.textContent).toContain('750.00');
    expect(first.textContent).toContain('75%');
    const bar = first.querySelector('[data-slot="summary-bar"]') as HTMLElement;
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('75%');
  });

  it('shows each currency total apart and keeps currencies separate', () => {
    renderApp(<CategorySummary view={VIEW} />, { locale: 'en' });
    expect(screen.getByText('1,000.00 ARS')).toBeTruthy();
    expect(screen.getAllByText('50.00 USD')).toHaveLength(2);
    const lists = screen.getAllByRole('list');
    expect(within(lists[0] as HTMLElement).queryByText(/USD/)).toBeNull();
    expect(within(lists[1] as HTMLElement).queryByText(/ARS/)).toBeNull();
  });

  it('selects a line by its ids and renders plain rows without onSelect', async () => {
    const onSelect = vi.fn();
    const { unmount } = renderApp(<CategorySummary view={VIEW} onSelect={onSelect} />, {
      locale: 'es',
    });
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    await userEvent.click(buttons[1] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(['trip']);
    unmount();
    renderApp(<CategorySummary view={VIEW} />, { locale: 'es' });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders a zero share as width 0 with its text and an empty view as nothing', () => {
    const zero: SummaryView = {
      currencies: [{ currency: 'ARS', total: 0n, count: 1, lines: [line('food', FOOD, 0n, 1, 0)] }],
    };
    const { container, unmount } = renderApp(<CategorySummary view={zero} />, { locale: 'en' });
    expect(container.textContent).toContain('0%');
    const bar = container.querySelector('[data-slot="summary-bar"]') as HTMLElement;
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('0%');
    unmount();
    const empty = renderApp(<CategorySummary view={{ currencies: [] }} />);
    expect(empty.container.textContent).toBe('');
  });
});

describe('localization and design scans', () => {
  it('renders Spanish text from the catalog', () => {
    renderApp(<CategoryChip display={OLD} />, { locale: 'es' });
    expect(screen.getByText(es.groups.categoryViews.chip.archived)).toBeTruthy();
    renderApp(<MonthPicker months={['2026-10']} value="2026-10" onChange={vi.fn()} />, {
      locale: 'es',
    });
    expect(screen.getByLabelText(es.groups.categoryViews.month.label)).toBeTruthy();
    expect(screen.getByText(/octubre/i)).toBeTruthy();
  });

  it('keeps the base keys in both catalogs with the same shape', () => {
    const shape = (value: unknown): unknown =>
      typeof value === 'object' && value !== null
        ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, shape(inner)]))
        : typeof value;
    for (const key of ['chip', 'filter', 'month', 'summary'] as const) {
      expect(shape(es.groups.categoryViews[key])).toEqual(shape(en.groups.categoryViews[key]));
    }
  });

  const dir = join(resolve(__dirname, '..'), 'src/features/groups/category-views/components');

  it('has no hex or rgb values, no raw HTML and no literal JSX text in the components', () => {
    const files = readdirSync(dir).filter((name) => name.endsWith('.tsx'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const name of files) {
      const text = readFileSync(join(dir, name), 'utf8');
      expect(text, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text, name).not.toMatch(/\brgba?\(/);
      expect(text, name).not.toContain('dangerouslySetInnerHTML');
      expect(text, name).not.toMatch(/>\s*[A-Za-z][^<>{}]*</);
    }
  });
});
