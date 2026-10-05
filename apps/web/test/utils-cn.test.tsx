// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { BottomNav } from '../src/features/shell/components/bottom-nav';
import { cn } from '../src/lib/utils';
import { renderApp } from './support/render-app';

const SIZES = ['display', 'title', 'heading', 'body', 'small', 'caption'] as const;
const COLOURS = [
  'muted-foreground',
  'primary',
  'income',
  'expense',
  'destructive',
  'foreground',
] as const;

describe('cn with the design-system type scale', () => {
  it('keeps a size class next to a colour class, in either order', () => {
    expect(cn('text-caption', 'text-muted-foreground')).toBe('text-caption text-muted-foreground');
    expect(cn('text-muted-foreground', 'text-caption')).toBe('text-muted-foreground text-caption');
  });

  it.each(SIZES.flatMap((size) => COLOURS.map((colour) => [size, colour] as const)))(
    'keeps text-%s next to text-%s',
    (size, colour) => {
      expect(cn(`text-${size}`, `text-${colour}`)).toBe(`text-${size} text-${colour}`);
    },
  );

  it('keeps only the last size when two sizes conflict', () => {
    expect(cn('text-small', 'text-heading')).toBe('text-heading');
    expect(cn('text-caption', 'text-sm')).toBe('text-sm');
  });

  it('keeps only the last colour when two colours conflict', () => {
    expect(cn('text-muted-foreground', 'text-primary')).toBe('text-primary');
    expect(cn('text-income', 'text-expense')).toBe('text-expense');
  });

  it('still merges the other custom tokens by their groups', () => {
    expect(cn('shadow-xs', 'shadow-md')).toBe('shadow-md');
    expect(cn('rounded-md', 'rounded-xl')).toBe('rounded-xl');
    expect(cn('p-4', 'p-page')).toBe('p-page');
    expect(cn('gap-2', 'gap-section')).toBe('gap-section');
    expect(cn('duration-fast', 'duration-base')).toBe('duration-base');
    expect(cn('ease-standard', 'ease-in')).toBe('ease-in');
  });
});

describe('a component built with cn keeps its type size', () => {
  it('bottom navigation labels stay at text-caption beside the colour classes', () => {
    const { container } = renderApp(<BottomNav currentPath="/accounts" />, { locale: 'en' });

    const links = Array.from(container.querySelectorAll('nav li a'));
    expect(links.length).toBeGreaterThan(0);
    // The circular add button has no label, so only the destinations are checked.
    for (const link of links.filter(
      (a) => !a.getAttribute('class')?.includes('size-circle-action'),
    )) {
      expect(link.className).toContain('text-caption');
    }
    const active = container.querySelector('a[aria-current="page"]');
    expect(active?.className).toContain('text-caption');
    expect(active?.className).toContain('text-accent-foreground');
    expect(active?.className).not.toContain('text-muted-foreground');
  });
});
