'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  THEME_STORAGE_KEY,
  parseTheme,
  resolveTheme,
  type Theme,
  type ThemeChoice,
} from '@/lib/theme';

interface ThemeContextValue {
  /** The resolved theme actually applied. */
  theme: Theme;
  /** What the user picked; `system` when nothing is stored. */
  choice: ThemeChoice;
  setTheme: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme | null {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Blocked storage (private mode): the preference simply is not remembered.
    return null;
  }
}

function storeTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Blocked storage: the theme stays in memory for this session.
  }
}

/**
 * Keeps the theme in memory, mirrors it to `localStorage` and applies the `dark` class on `<html>`.
 * The first render has no stored choice so server and client markup match; the pre-paint script has
 * already set the right class, and nothing touches it until the stored value has been read.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Theme | null>(null);
  const [prefersDark, setPrefersDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Some embedded browsers have no `matchMedia`: the theme then follows the light default.
    const query =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    const onChange = (event: { matches: boolean }) => {
      setPrefersDark(event.matches);
    };
    // Another tab changed the preference: `key` is null when its storage was cleared.
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) setStored(readStoredTheme());
    };
    setStored(readStoredTheme());
    setPrefersDark(query?.matches ?? false);
    setReady(true);
    query?.addEventListener('change', onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      query?.removeEventListener('change', onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const theme = resolveTheme(stored, prefersDark);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [ready, theme]);

  const choice: ThemeChoice = stored ?? 'system';

  const setTheme = useCallback((next: ThemeChoice) => {
    // "System" is stored as the absence of the key, so the pre-paint script keeps working unchanged.
    setStored(next === 'system' ? null : next);
    storeTheme(next);
  }, []);

  const value = useMemo(() => ({ theme, choice, setTheme }), [theme, choice, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
