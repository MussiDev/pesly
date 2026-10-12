// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import { ThemeProvider, useTheme } from '../src/components/theme-provider';
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

function Probe() {
  const { theme, choice } = useTheme();
  return <output data-testid="probe">{`${choice}:${theme}`}</output>;
}

function renderToggle() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ThemeProvider>
        <ThemeToggle />
        <Probe />
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

const isDark = () => document.documentElement.classList.contains('dark');
const probe = () => screen.getByTestId('probe').textContent;
const radio = (name: string) => screen.getByRole<HTMLInputElement>('radio', { name });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ThemeProvider', () => {
  it('exposes the choice and the resolved theme (AC-06)', async () => {
    stubSystemPreference(true);
    const user = userEvent.setup();
    renderToggle();

    expect(probe()).toBe('system:dark');
    await user.click(radio('Light'));
    expect(probe()).toBe('light:light');
    expect(isDark()).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('applies the chosen theme immediately and persists it after remount (AC-06)', async () => {
    stubSystemPreference(false);
    const user = userEvent.setup();
    const first = renderToggle();

    await user.click(radio('Dark'));
    expect(isDark()).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    first.unmount();
    document.documentElement.classList.remove('dark');
    renderToggle();

    expect(isDark()).toBe(true);
    expect(radio('Dark').checked).toBe(true);
  });

  it('follows the operating system until a choice is stored (AC-08)', () => {
    const system = stubSystemPreference(true);
    renderToggle();

    expect(isDark()).toBe(true);
    act(() => {
      system.set(false);
    });
    expect(isDark()).toBe(false);
    expect(probe()).toBe('system:light');
  });

  it('ignores the operating system once a choice is made', async () => {
    const system = stubSystemPreference(false);
    const user = userEvent.setup();
    renderToggle();

    await user.click(radio('Light'));
    act(() => {
      system.set(true);
    });

    expect(isDark()).toBe(false);
  });

  it.each(['<img src=x>', 'system'])('treats the stored value %j as system', (value) => {
    stubSystemPreference(false);
    localStorage.setItem(THEME_STORAGE_KEY, value);

    renderToggle();

    expect(isDark()).toBe(false);
    expect(probe()).toBe('system:light');
  });

  it('keeps the choice in memory when localStorage throws', async () => {
    stubSystemPreference(false);
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    const user = userEvent.setup();

    renderToggle();
    await user.click(radio('Dark'));

    expect(isDark()).toBe(true);
    expect(probe()).toBe('dark:dark');
  });

  it('removes its media listener on unmount', () => {
    const system = stubSystemPreference(false);
    const view = renderToggle();
    view.unmount();

    expect(() => {
      system.set(true);
    }).not.toThrow();
  });

  it('throws when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
    spy.mockRestore();
  });
});
