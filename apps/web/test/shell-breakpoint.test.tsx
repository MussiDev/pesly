// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BottomNav } from '../src/features/shell/components/bottom-nav';
import { TopNav } from '../src/features/shell/components/top-nav';
import { useCompactViewport } from '../src/lib/use-compact-viewport';
import { renderApp } from './support/render-app';

const SRC = join(__dirname, '..', 'src');

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return /\.(ts|tsx|css)$/.test(name) ? [path] : [];
  });
}

/** A width-aware matchMedia: only `max-width` queries in rem or px are understood. */
function stubViewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string): MediaQueryList => {
    const match = /max-width:\s*([\d.]+)(rem|px)/.exec(query);
    const limit = match ? +(match[1] ?? '0') * (match[2] === 'rem' ? 16 : 1) : -1;
    return {
      matches: width <= limit,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as MediaQueryList;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('desk breakpoint token (AC-38, AC-39, AC-40)', () => {
  it('is 64rem in globals.css, in one place', () => {
    const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/--breakpoint-desk:\s*64rem;/);
    expect(css.match(/--breakpoint-desk/g)).toHaveLength(1);
  });

  it('is no longer 900 px anywhere in the app sources', () => {
    const offenders = sourcesUnder(SRC).filter((file) => {
      const text = readFileSync(file, 'utf8');
      return /56\.25rem|56\.2475rem|\b900\s?px\b/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});

describe('useCompactViewport', () => {
  it.each([
    [900, true],
    [1023, true],
    [1024, false],
    [1920, false],
  ])('at %i px compact is %s', (width, expected) => {
    stubViewport(width);
    const { result } = renderHook(() => useCompactViewport());
    expect(result.current).toBe(expected);
  });

  it('falls back to not compact without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useCompactViewport());
    expect(result.current).toBe(false);
  });
});

describe('navigation visibility classes', () => {
  it('shows the side menu from desk and hides the bottom bar from desk', () => {
    const { container } = renderApp(
      <>
        <TopNav currentPath="/" signingOut={false} onSignOut={vi.fn()} />
        <BottomNav currentPath="/" />
      </>,
    );
    const top = container.querySelector('[data-slot="top-nav"]');
    const bottom = container.querySelector('[data-slot="bottom-nav"]');
    expect(top?.className).toContain('hidden');
    expect(top?.className).toContain('desk:flex');
    expect(bottom?.className).toContain('desk:hidden');
  });
});

describe('side menu footer (NFR-08)', () => {
  it('puts the theme control and the sign out button each on its own row', () => {
    const { container } = renderApp(
      <TopNav currentPath="/" signingOut={false} onSignOut={vi.fn()} />,
    );
    const footer = container.querySelector('[data-slot="top-nav-footer"]');
    expect(footer).not.toBeNull();
    const theme = footer?.querySelector('[data-slot="top-nav-theme"]');
    const signOut = footer?.querySelector('[data-slot="top-nav-sign-out"]');
    expect(theme).not.toBeNull();
    expect(signOut).not.toBeNull();
    expect(theme).not.toBe(signOut);
    expect(theme?.contains(signOut ?? null)).toBe(false);
    expect(footer?.className).toContain('grid');
    expect(theme?.querySelector('button, input')).not.toBeNull();
    expect(signOut?.querySelector('button')).not.toBeNull();
  });

  it('keeps a 44 px height class on every navigation link', () => {
    const { container } = renderApp(
      <TopNav currentPath="/" signingOut={false} onSignOut={vi.fn()} />,
    );
    const links = container.querySelectorAll('[data-slot="top-nav"] ul a');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.className).toContain('h-11');
  });
});
