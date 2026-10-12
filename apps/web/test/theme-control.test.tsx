// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { runInNewContext } from 'node:vm';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { ThemeProvider } from '../src/components/theme-provider';
import { ThemeToggle } from '../src/components/theme-toggle';
import { THEME_CHOICES, THEME_SCRIPT, THEME_STORAGE_KEY, parseThemeChoice } from '../src/lib/theme';

type Listener = (event: { matches: boolean }) => void;

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

function renderControl(locale: 'en' | 'es' = 'en', count = 1) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : es}>
      <ThemeProvider>
        {Array.from({ length: count }, (_, index) => (
          <ThemeToggle key={index} />
        ))}
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

const isDark = () => document.documentElement.classList.contains('dark');
const radio = (name: string) => screen.getByRole<HTMLInputElement>('radio', { name });

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('parseThemeChoice', () => {
  it('lists the three choices', () => {
    expect([...THEME_CHOICES]).toEqual(['light', 'dark', 'system']);
  });

  it.each(['light', 'dark'])('keeps the stored value %j', (value) => {
    expect(parseThemeChoice(value)).toBe(value);
  });

  it.each([null, undefined, '', 'purple', 'system', 'DARK', 3, {}])(
    'answers system for %j',
    (value) => {
      expect(parseThemeChoice(value)).toBe('system');
    },
  );
});

describe('ThemeToggle as a three-option control', () => {
  it('offers light, dark and system in a labeled group (AC-41)', () => {
    stubSystemPreference(false);
    renderControl();

    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual([
      'light',
      'dark',
      'system',
    ]);
  });

  it('checks System with nothing stored and follows the operating system (AC-42)', () => {
    stubSystemPreference(true);
    renderControl();

    expect(radio('System').checked).toBe(true);
    expect(radio('Dark').checked).toBe(false);
    expect(isDark()).toBe(true);
  });

  it('marks the current option with a check mark besides the checked state (AC-41)', async () => {
    stubSystemPreference(false);
    const user = userEvent.setup();
    renderControl();

    const marks = () => document.querySelectorAll('[data-slot="theme-check"]');
    expect(marks()).toHaveLength(1);
    expect(
      radio('System').closest('label')?.querySelector('[data-slot="theme-check"]'),
    ).not.toBeNull();

    await user.click(radio('Dark'));
    expect(marks()).toHaveLength(1);
    expect(
      radio('Dark').closest('label')?.querySelector('[data-slot="theme-check"]'),
    ).not.toBeNull();
  });

  it('toggles the dark class when the system changes while System is chosen (AC-43)', () => {
    const system = stubSystemPreference(false);
    renderControl();

    expect(isDark()).toBe(false);
    act(() => {
      system.set(true);
    });
    expect(isDark()).toBe(true);
    act(() => {
      system.set(false);
    });
    expect(isDark()).toBe(false);
  });

  it('ignores the system once light or dark is chosen', async () => {
    const system = stubSystemPreference(false);
    const user = userEvent.setup();
    renderControl();

    await user.click(radio('Light'));
    act(() => {
      system.set(true);
    });
    expect(isDark()).toBe(false);
  });

  it('stores dark, removes the key for system and survives a remount (AC-44)', async () => {
    stubSystemPreference(false);
    const user = userEvent.setup();
    const first = renderControl();

    await user.click(radio('Dark'));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(isDark()).toBe(true);

    first.unmount();
    document.documentElement.classList.remove('dark');
    renderControl();
    expect(isDark()).toBe(true);
    expect(radio('Dark').checked).toBe(true);

    await user.click(radio('Light'));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    await user.click(radio('System'));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(radio('System').checked).toBe(true);
    expect(isDark()).toBe(false);
  });

  it('keeps the choice for the session when localStorage is blocked (AC-45)', async () => {
    stubSystemPreference(false);
    const blocked = () => {
      throw new Error('blocked');
    };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    const user = userEvent.setup();
    renderControl();

    await user.click(radio('Dark'));
    expect(isDark()).toBe(true);
    expect(radio('Dark').checked).toBe(true);

    await user.click(radio('System'));
    expect(radio('System').checked).toBe(true);
    expect(isDark()).toBe(false);
  });

  it.each(['purple', 'system', '<img src=x>'])(
    'treats the stored value %j as no choice (AC-46)',
    (value) => {
      stubSystemPreference(true);
      localStorage.setItem(THEME_STORAGE_KEY, value);
      renderControl();

      expect(radio('System').checked).toBe(true);
      expect(isDark()).toBe(true);
    },
  );

  it('moves and selects with the arrow keys (NFR-08)', async () => {
    stubSystemPreference(false);
    const user = userEvent.setup();
    renderControl();

    radio('System').focus();
    await user.keyboard('{ArrowLeft}');
    expect(radio('Dark').checked).toBe(true);
    expect(isDark()).toBe(true);
    await user.keyboard('{ArrowLeft}');
    expect(radio('Light').checked).toBe(true);
    expect(isDark()).toBe(false);
  });

  it('gives every option a label of at least 44 px (NFR-08)', () => {
    stubSystemPreference(false);
    renderControl();

    for (const r of screen.getAllByRole('radio')) {
      const label = r.closest('label');
      expect(label?.className).toMatch(/min-h-11/);
      expect(label?.textContent.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps several controls in one document in sync, each its own group', async () => {
    stubSystemPreference(false);
    const user = userEvent.setup();
    renderControl('en', 2);

    await user.click(screen.getAllByRole('radio', { name: 'Dark' })[1] as HTMLElement);

    for (const r of screen.getAllByRole('radio', { name: 'Dark' })) {
      expect((r as HTMLInputElement).checked).toBe(true);
    }
    expect(isDark()).toBe(true);
  });

  it.each([
    ['en', ['Light', 'Dark', 'System']],
    ['es', ['Claro', 'Oscuro', 'Sistema']],
  ] as const)('renders the labels in %s (FR-20)', (locale, labels) => {
    stubSystemPreference(false);
    renderControl(locale);

    for (const label of labels) expect(radio(label)).toBeTruthy();
  });
});

/** Runs the constant pre-paint script against the current document, storage and media stub. */
function runScript() {
  runInNewContext(THEME_SCRIPT, {
    document,
    localStorage,
    matchMedia: (query: string) => window.matchMedia(query),
  });
}

describe('pre-paint script', () => {
  it('is constant, reads the same key and applies dark for a stored dark (AC-46)', () => {
    expect(THEME_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_SCRIPT).not.toMatch(/\$\{|\+\s*[a-z]+\s*\+/);
    document.documentElement.classList.remove('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    stubSystemPreference(false);
    runScript();
    expect(isDark()).toBe(true);
  });

  it('follows the system for a legacy stored system value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    stubSystemPreference(true);
    runScript();
    expect(isDark()).toBe(true);
  });
});
