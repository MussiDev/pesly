import { cleanup, render, type RenderResult } from '@testing-library/react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, vi, type Mock } from 'vitest';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import { ThemeProvider } from '../../src/components/theme-provider';
import { ApiClientProvider } from '../../src/lib/api-client-provider';

export const CATALOGS = { es, en } as const;
export type TestLocale = keyof typeof CATALOGS;

export const API_ORIGIN = 'http://api.argent.test';

/** A 43-character base64url one-time token, as the email links carry. */
export const VALID_TOKEN = 'A'.repeat(43);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

/** One recorded API call: method, path (without origin) and the JSON body, if any. */
export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

type Answer =
  { status: number; body?: unknown; headers?: Record<string, string> } | 'network-error';

/**
 * Stubs `fetch` with fixed answers per `METHOD /path`, so the real API client (and its schemas)
 * run without a network. Unlisted routes answer 500. Each route may list answers used in order;
 * the last one repeats.
 */
export function stubApi(routes: Record<string, Answer | Answer[]>) {
  const calls: ApiCall[] = [];
  const served = new Map<string, number>();
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = url.slice(API_ORIGIN.length);
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });

    const key = `${method} ${path}`;
    const configured = routes[key];
    const answers = configured === undefined ? [] : [configured].flat();
    const index = served.get(key) ?? 0;
    served.set(key, index + 1);
    const answer = answers[Math.min(index, answers.length - 1)] ?? { status: 500 };

    if (answer === 'network-error') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(
      new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json', ...answer.headers },
      }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  return { calls, fetch };
}

export interface FakeRouter {
  push: Mock<(href: string) => void>;
  replace: Mock<(href: string) => void>;
  back: Mock<() => void>;
  forward: Mock<() => void>;
  refresh: Mock<() => void>;
  prefetch: Mock<(href: string) => void>;
  bfcacheId: string;
}

export interface RenderedApp extends RenderResult {
  router: FakeRouter;
}

/**
 * Renders a screen the way `app/[locale]/layout.tsx` does: catalogs of `locale`, one API client
 * for `API_ORIGIN`, and next-intl navigation on top of a fake Next.js app router that records
 * where the screen navigates to. The theme provider is mounted too, as in the layout, because the
 * shell renders the theme toggle. `strict` renders under a root StrictMode, which (unlike a nested
 * `<StrictMode>`) makes React mount, unmount and remount effects as in development. `pathname` is
 * what Next.js' `usePathname()` reports (with the locale prefix), `null` as outside Next.js.
 */
export function renderApp(
  ui: ReactElement,
  {
    locale = 'es',
    strict = false,
    pathname = null,
  }: { locale?: TestLocale; strict?: boolean; pathname?: string | null } = {},
): RenderedApp {
  const router: FakeRouter = {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    bfcacheId: 'test',
  };
  // A wrapper (not a wrapped `ui`) so `rerender` keeps the providers.
  function Providers({ children }: { children: ReactNode }) {
    return (
      <AppRouterContext.Provider value={router}>
        <PathnameContext.Provider value={pathname}>
          <NextIntlClientProvider locale={locale} timeZone="UTC" messages={CATALOGS[locale]}>
            <ThemeProvider>
              <ApiClientProvider apiOrigin={API_ORIGIN}>{children}</ApiClientProvider>
            </ThemeProvider>
          </NextIntlClientProvider>
        </PathnameContext.Provider>
      </AppRouterContext.Provider>
    );
  }
  const result = render(ui, { wrapper: Providers, reactStrictMode: strict });
  return { ...result, router };
}
