// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Plus } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Avatar } from '../src/components/ui/avatar';
import { Chip } from '../src/components/ui/chip';
import {
  CircularAction,
  CircularActionFace,
  circularActionVariants,
} from '../src/components/ui/circular-action';
import { DonutChart } from '../src/components/ui/donut-chart';
import { PillTabs } from '../src/components/ui/pill-tabs';

afterEach(cleanup);

describe('Avatar (AC-27, AC-28, AC-29)', () => {
  it('renders the logo with an empty alt, explicit size and lazy loading', () => {
    const { container } = render(<Avatar src="/logos/spotify.svg" fallback="S" size="md" />);

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('alt')).toBe('');
    expect(image?.getAttribute('src')).toBe('/logos/spotify.svg');
    expect(image?.getAttribute('width')).toBe('40');
    expect(image?.getAttribute('height')).toBe('40');
    expect(image?.getAttribute('loading')).toBe('lazy');
  });

  it('reserves its box through a fixed-size circle on the logo surface', () => {
    const { container } = render(<Avatar src="/logos/spotify.svg" fallback="S" size="lg" />);

    const avatar = container.querySelector('[data-slot="avatar"]');
    expect(avatar?.className).toMatch(/size-12/);
    expect(avatar?.className).toMatch(/rounded-pill/);
    expect(avatar?.className).toMatch(/bg-logo-surface/);
  });

  it('shows only the fallback when there is no logo', () => {
    const { container } = render(<Avatar fallback="GG" />);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('GG')).toBeDefined();
  });

  it('error: a logo that fails to load is replaced by the fallback and leaves no image', () => {
    const { container } = render(<Avatar src="/logos/broken.svg" fallback="BR" />);

    fireEvent.error(container.querySelector('img') as HTMLImageElement);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('BR')).toBeDefined();
  });

  it('error: after a failure a new src is tried again and the image returns', () => {
    const { container, rerender } = render(<Avatar src="/logos/broken.svg" fallback="BR" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);

    rerender(<Avatar src="/logos/netflix.svg" fallback="BR" />);

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/logos/netflix.svg');
  });
});

describe('DonutChart (AC-06)', () => {
  const percent = (basisPoints: number) => `${(basisPoints / 100).toFixed(0)}%`;
  const segments = [
    { key: 'stock', label: 'Stocks', basisPoints: 6000 },
    { key: 'bond', label: 'Bonds', basisPoints: 3000 },
    { key: 'crypto', label: 'Crypto', basisPoints: 1000 },
  ];

  it('draws one arc per positive segment and a legend with each label and percentage', () => {
    const { container } = render(
      <DonutChart label="Portfolio composition" segments={segments} formatPercent={percent} />,
    );

    expect(container.querySelectorAll('circle[data-segment]')).toHaveLength(3);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('Stocks');
    expect(items[0]?.textContent).toContain('60%');
    expect(screen.getByRole('img', { name: 'Portfolio composition' })).toBeDefined();
  });

  it('colours the arcs from the chart tokens only', () => {
    const { container } = render(
      <DonutChart label="Portfolio composition" segments={segments} formatPercent={percent} />,
    );

    const arcs = [...container.querySelectorAll('circle[data-segment]')];
    expect(arcs.map((arc) => arc.getAttribute('class'))).toEqual([
      expect.stringContaining('stroke-chart-1'),
      expect.stringContaining('stroke-chart-2'),
      expect.stringContaining('stroke-chart-3'),
    ]);
  });

  it('error: a missing, zero, negative or fractional weight is omitted and the rest still renders', () => {
    const { container } = render(
      <DonutChart
        label="Portfolio composition"
        formatPercent={percent}
        segments={[
          { key: 'a', label: 'Kept', basisPoints: 5000 },
          { key: 'b', label: 'Zero', basisPoints: 0 },
          { key: 'c', label: 'Negative', basisPoints: -100 },
          { key: 'd', label: 'Fraction', basisPoints: 12.5 },
          { key: 'e', label: 'Not a number', basisPoints: Number.NaN },
        ]}
      />,
    );

    expect(container.querySelectorAll('circle[data-segment]')).toHaveLength(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('Zero')).toBeNull();
  });

  it('error: with no positive segment it renders nothing and does not throw on an invalid weight', () => {
    const { container } = render(
      <DonutChart
        label="Portfolio composition"
        formatPercent={percent}
        segments={[
          { key: 'a', label: 'Zero', basisPoints: 0 },
          { key: 'b', label: 'Invalid', basisPoints: Number.POSITIVE_INFINITY },
        ]}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});

describe('Chip, PillTabs and CircularAction (AC-06, AC-40)', () => {
  it('Chip exposes its name and pressed state, reaches 44 px and shows a focus ring', async () => {
    const onClick = vi.fn();
    render(
      <Chip pressed onClick={onClick}>
        All
      </Chip>,
    );

    const chip = screen.getByRole('button', { name: 'All' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.className).toMatch(/min-h-11/);
    expect(chip.className).toMatch(/focus-visible:ring-2/);
    await userEvent.setup().click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('PillTabs groups its options by name and reports the chosen value', async () => {
    const onChange = vi.fn();
    render(
      <PillTabs
        label="Range"
        value="3m"
        onChange={onChange}
        options={[
          { value: '1m', label: '1M' },
          { value: '3m', label: '3M' },
        ]}
      />,
    );

    expect(screen.getByRole('group', { name: 'Range' })).toBeDefined();
    expect(screen.getByRole('button', { name: '3M' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '1M' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: '1M' }).className).toMatch(/min-h-11/);
    await userEvent.setup().click(screen.getByRole('button', { name: '1M' }));
    expect(onChange).toHaveBeenCalledWith('1m');
  });

  it('CircularAction names itself from its label, uses the circle token and shows a focus ring', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <CircularAction icon={<Plus />} label="Expense" tone="primary" onClick={onClick} />,
    );

    const action = screen.getByRole('button', { name: 'Expense' });
    expect(action.className).toMatch(/focus-visible:ring-2/);
    expect(container.querySelector('[data-slot="circular-action-circle"]')?.className).toMatch(
      /size-circle-action/,
    );
    await userEvent.setup().click(action);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('circularActionVariants styles a link the way buttonVariants does', () => {
    render(
      <a href="/movements/new" className={circularActionVariants()}>
        <CircularActionFace icon={<Plus />} label="Income" />
      </a>,
    );

    const link = screen.getByRole('link', { name: 'Income' });
    expect(link.className).toMatch(/focus-visible:ring-2/);
  });
});
