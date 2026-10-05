// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { ThemeProvider } from '../src/components/theme-provider';
import { ThemeToggle } from '../src/components/theme-toggle';
import { THEME_STORAGE_KEY } from '../src/lib/theme';

type Listener = (event: { matches: boolean }) => void;

/** A controllable `prefers-color-scheme` that notifies listeners when the "system" changes. */
function stubSystemPreference(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<Listener>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return dark;
    },
    media: query,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  }));
  return {
    set(next: boolean) {
      dark = next;
      for (const listener of listeners) listener({ matches: next });
    },
  };
}

function renderToggle(locale: 'en' | 'es' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : es}>
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

const isDark = () => document.documentElement.classList.contains('dark');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const darkSwitch = (name = 'Dark mode') => screen.getByRole('switch', { name });

describe('ThemeProvider and ThemeToggle', () => {
  it('applies the chosen theme immediately and persists it after remount (AC-06)', async () => {
    stubSystemPreference(false);
    const user = userEvent.setup();
    const first = renderToggle();

    expect(darkSwitch().getAttribute('aria-checked')).toBe('false');
    await user.click(darkSwitch());
    expect(isDark()).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    first.unmount();
    document.documentElement.classList.remove('dark');
    renderToggle();

    expect(isDark()).toBe(true);
    expect(darkSwitch().getAttribute('aria-checked')).toBe('true');

    await user.click(darkSwitch());
    expect(isDark()).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('follows the operating system until a choice is stored (AC-08)', () => {
    const system = stubSystemPreference(true);
    renderToggle();

    expect(isDark()).toBe(true);
    expect(darkSwitch().getAttribute('aria-checked')).toBe('true');

    act(() => {
      system.set(false);
    });
    expect(isDark()).toBe(false);
    expect(darkSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('ignores the operating system once a choice is made', async () => {
    const system = stubSystemPreference(false);
    const user = userEvent.setup();
    renderToggle();

    await user.click(darkSwitch());
    await user.click(darkSwitch());
    act(() => {
      system.set(true);
    });

    expect(isDark()).toBe(false);
  });

  it.each(['<img src=x>', 'system'])('treats the stored value %j as unset', (value) => {
    stubSystemPreference(false);
    localStorage.setItem(THEME_STORAGE_KEY, value);

    renderToggle();

    expect(isDark()).toBe(false);
    expect(darkSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('keeps the theme in memory when localStorage throws', async () => {
    stubSystemPreference(false);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const user = userEvent.setup();

    renderToggle();
    await user.click(darkSwitch());

    expect(isDark()).toBe(true);
    expect(darkSwitch().getAttribute('aria-checked')).toBe('true');
  });

  it('is named in the active language', () => {
    stubSystemPreference(false);
    renderToggle('es');

    expect(darkSwitch('Modo oscuro')).toBeTruthy();
  });

  it('reaches the 44px touch target through its hit area (class contract)', () => {
    stubSystemPreference(false);
    renderToggle();

    expect(darkSwitch().className).toMatch(/before:-inset-y-2/);
  });

  it('keeps several switches in one document in sync', async () => {
    stubSystemPreference(false);
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ThemeProvider>
          <ThemeToggle />
          <ThemeToggle />
        </ThemeProvider>
      </NextIntlClientProvider>,
    );

    await user.click(screen.getAllByRole('switch', { name: 'Dark mode' })[1] as HTMLElement);

    for (const toggle of screen.getAllByRole('switch', { name: 'Dark mode' })) {
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    }
    expect(isDark()).toBe(true);
  });
});
