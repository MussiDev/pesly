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
import { THEME_STORAGE_KEY, parseTheme, resolveTheme, type Theme } from '@/lib/theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
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

function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
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
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: { matches: boolean }) => {
      setPrefersDark(event.matches);
    };
    setStored(readStoredTheme());
    setPrefersDark(query.matches);
    setReady(true);
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, []);

  const theme = resolveTheme(stored, prefersDark);

  useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [ready, theme]);

  const setTheme = useCallback((next: Theme) => {
    setStored(next);
    storeTheme(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
