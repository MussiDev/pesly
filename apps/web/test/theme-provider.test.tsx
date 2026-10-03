// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from '@testing-library/react';
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

describe('ThemeProvider and ThemeToggle', () => {
  it('applies the chosen theme immediately and persists it after remount (AC-06)', async () => {
    stubSystemPreference(false);
    const user = userEvent.setup();
    const first = renderToggle();

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(isDark()).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    first.unmount();
    document.documentElement.classList.remove('dark');
    renderToggle();

    expect(isDark()).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Dark' }).checked).toBe(true);

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    expect(isDark()).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('follows the operating system with no stored theme and while system is chosen (AC-08)', () => {
    const system = stubSystemPreference(true);
    renderToggle();

    expect(isDark()).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'System' }).checked).toBe(true);

    act(() => {
      system.set(false);
    });
    expect(isDark()).toBe(false);
  });

  it('ignores the operating system once light or dark is chosen', async () => {
    const system = stubSystemPreference(false);
    const user = userEvent.setup();
    renderToggle();

    await user.click(screen.getByRole('radio', { name: 'Light' }));
    act(() => {
      system.set(true);
    });

    expect(isDark()).toBe(false);
  });

  it('treats a tampered stored value as system', () => {
    stubSystemPreference(false);
    localStorage.setItem(THEME_STORAGE_KEY, '<img src=x>');

    renderToggle();

    expect(isDark()).toBe(false);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'System' }).checked).toBe(true);
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
    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(isDark()).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Dark' }).checked).toBe(true);
  });

  it('labels the three options in the active language', () => {
    stubSystemPreference(false);
    renderToggle('es');

    expect(screen.getByRole('radio', { name: 'Claro' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Oscuro' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Sistema' })).toBeTruthy();
  });

  it('keeps every option at least 44px tall (class contract)', () => {
    stubSystemPreference(false);
    renderToggle();

    const option = screen.getByRole('radio', { name: 'Dark' }).closest('label');
    expect(option?.className).toMatch(/min-h-11/);
  });

  it('keeps several toggles in one document independent groups that share the theme', async () => {
    stubSystemPreference(false);
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="es" messages={es}>
        <ThemeProvider>
          <div data-testid="first">
            <ThemeToggle />
          </div>
          <div data-testid="second">
            <ThemeToggle />
          </div>
        </ThemeProvider>
      </NextIntlClientProvider>,
    );
    const radio = (id: string, name: string) =>
      within(screen.getByTestId(id)).getByRole<HTMLInputElement>('radio', { name });

    expect(radio('first', 'Claro').name).not.toBe(radio('second', 'Claro').name);

    await user.click(radio('second', 'Oscuro'));
    await user.click(radio('second', 'Claro'));

    expect(radio('second', 'Claro').checked).toBe(true);
    expect(radio('first', 'Claro').checked).toBe(true);
    expect(radio('first', 'Oscuro').checked).toBe(false);
    expect(isDark()).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    await user.click(radio('second', 'Oscuro'));
    expect(radio('first', 'Oscuro').checked).toBe(true);
    expect(isDark()).toBe(true);
  });
});

describe('ThemeToggle compact variant (side navigation)', () => {
  function renderCompact() {
    stubSystemPreference(false);
    return render(
      <NextIntlClientProvider locale="es" messages={es}>
        <ThemeProvider>
          <ThemeToggle size="compact" />
        </ThemeProvider>
      </NextIntlClientProvider>,
    );
  }

  it('keeps all three options with their accessible names and 44px targets', () => {
    const { container } = renderCompact();

    for (const name of [es.theme.light, es.theme.dark, es.theme.system]) {
      expect(screen.getByRole('radio', { name })).toBeDefined();
    }
    for (const label of container.querySelectorAll('label')) {
      expect(label.classList.contains('min-h-11')).toBe(true);
    }
  });

  it('can shrink to its container: full width, equal flexible options, no fixed widths', () => {
    const { container } = renderCompact();

    const group = container.querySelector('fieldset > div');
    expect(group?.classList.contains('flex')).toBe(true);
    expect(group?.classList.contains('w-full')).toBe(true);
    expect(group?.classList.contains('inline-flex')).toBe(false);
    for (const label of container.querySelectorAll('label')) {
      expect(label.classList.contains('flex-1')).toBe(true);
      expect(label.classList.contains('min-w-0')).toBe(true);
      expect(label.classList.contains('min-w-11')).toBe(false);
      expect(Array.from(label.classList).some((name) => /^(w|px)-(?!full)/.test(name))).toBe(false);
    }
  });

  it('shows icons only, since the names do not fit the sidebar, and keeps a tooltip', () => {
    const { container } = renderCompact();

    for (const label of container.querySelectorAll('label')) {
      expect(label.querySelector('span')?.classList.contains('hidden')).toBe(true);
      expect(label.getAttribute('title')).toBeTruthy();
    }
  });

  it('keeps the default variant inline with its visible names', () => {
    const { container } = renderToggle('es');

    expect(container.querySelector('fieldset > div')?.classList.contains('inline-flex')).toBe(true);
    expect(container.querySelector('label span')?.classList.contains('hidden')).toBe(false);
  });
});
