// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CategoryPie, type CategoryPieSegment } from '../src/components/ui/category-pie';
import { renderApp } from './support/render-app';

const SEGMENTS: CategoryPieSegment[] = [
  { key: 'food', label: 'Food', amounts: ['$ 600'], basisPoints: 6000, color: 'orange' },
  { key: 'home', label: 'Home', amounts: ['$ 400'], basisPoints: 4000, color: 'not-a-colour' },
  { key: 'usd', label: 'Dollars only', amounts: ['US$ 5'], basisPoints: 0 },
];

const arc = (key: string) => document.querySelector(`circle[data-segment="${key}"]`);

describe('CategoryPie', () => {
  it('draws an arc per weighted segment and lists every segment with its share', () => {
    renderApp(
      <CategoryPie label="Spending" segments={SEGMENTS} formatPercent={(bp) => `${bp / 100}%`} />,
      { locale: 'en' },
    );

    expect(screen.getByRole('img', { name: 'Spending' })).toBeDefined();
    expect(arc('food')?.getAttribute('class')).toContain('stroke-category-orange');
    // An unknown colour key takes the neutral palette instead of a raw value.
    expect(arc('home')?.getAttribute('class')).toMatch(/stroke-category-/);
    expect(arc('usd')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('60%')).toBeDefined();
    // Without `onSelect` nothing is a button.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('fades the other arcs around the selected one, which is no longer offered', () => {
    const onSelect = vi.fn();
    renderApp(
      <CategoryPie
        label="Spending"
        segments={SEGMENTS.map((segment) => ({ ...segment, actionLabel: `Open ${segment.label}` }))}
        formatPercent={(bp) => `${bp / 100}%`}
        selectedKey="food"
        onSelect={onSelect}
      />,
      { locale: 'en' },
    );

    expect(arc('food')?.getAttribute('stroke-width')).toBe('26');
    expect(arc('home')?.getAttribute('class')).toContain('opacity-30');
    expect(screen.queryByRole('button', { name: 'Open Food' })).toBeNull();
    screen.getByRole('button', { name: 'Open Home' }).click();
    expect(onSelect).toHaveBeenCalledWith('home');
  });

  it('fades nothing when the selection is not one of its segments, and draws nothing at all without weights', () => {
    const { unmount } = renderApp(
      <CategoryPie
        label="Spending"
        segments={SEGMENTS}
        formatPercent={(bp) => `${bp / 100}%`}
        selectedKey="parent-of-these"
      />,
      { locale: 'en' },
    );
    expect(arc('home')?.getAttribute('class')).not.toContain('opacity-30');
    unmount();

    renderApp(
      <CategoryPie
        label="Spending"
        segments={[{ key: 'x', label: 'X', amounts: ['$ 0'], basisPoints: 0 }]}
        formatPercent={(bp) => `${bp / 100}%`}
        visibleRows={1}
      />,
      { locale: 'en' },
    );
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('X')).toBeDefined();
  });
});
