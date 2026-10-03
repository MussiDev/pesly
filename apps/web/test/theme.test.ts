// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_SCRIPT, THEME_STORAGE_KEY, parseTheme, resolveTheme } from '../src/lib/theme';

function runScript(): void {
  runInThisContext(THEME_SCRIPT);
}

function stubPrefersDark(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('parseTheme', () => {
  it.each(['light', 'dark', 'system'] as const)('accepts %s', (value) => {
    expect(parseTheme(value)).toBe(value);
  });

  it.each([null, undefined, '', 'DARK', 'sepia', '<script>', 42, {}])(
    'treats %j as system (tampered or missing storage)',
    (value) => {
      expect(parseTheme(value)).toBe('system');
    },
  );
});

describe('resolveTheme', () => {
  it('follows the operating system only for system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('stores the preference under pesly-theme', () => {
    expect(THEME_STORAGE_KEY).toBe('pesly-theme');
  });
});

describe('pre-paint script', () => {
  it('is a constant string with no interpolation (R-01)', () => {
    const source = readFileSync(resolve(__dirname, '../src/lib/theme.ts'), 'utf8');

    expect(typeof THEME_SCRIPT).toBe('string');
    expect(THEME_SCRIPT).not.toContain('${');
    expect(source).toMatch(/THEME_SCRIPT\s*=\s*'/);
  });

  it('reads the same key the provider writes', () => {
    expect(THEME_SCRIPT).toContain(THEME_STORAGE_KEY);
  });

  it('sets the dark class from the stored theme', () => {
    stubPrefersDark(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    runScript();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('keeps light when the stored theme is light, even if the system prefers dark', () => {
    stubPrefersDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');

    runScript();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('follows the system preference without a stored theme (AC-08)', () => {
    stubPrefersDark(true);
    runScript();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    document.documentElement.classList.remove('dark');
    stubPrefersDark(false);
    runScript();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('treats a tampered stored value as system', () => {
    stubPrefersDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'bogus');

    runScript();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('does not throw when localStorage throws', () => {
    stubPrefersDark(true);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });

    expect(runScript).not.toThrow();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
