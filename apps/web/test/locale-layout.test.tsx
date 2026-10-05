import { createTranslator } from 'next-intl';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';

const mocks = vi.hoisted(() => ({
  requestHeaders: new Headers(),
  // next/font needs a module-scope call, so the layout calls it once when it is imported.
  inter: vi.fn(() => ({ className: 'inter-class', variable: 'inter-variable', style: {} })),
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(mocks.requestHeaders),
}));

vi.mock('next/font/google', () => ({ Inter: mocks.inter }));

// Outside React Server Components next-intl ships stubs; this is the server build's behaviour.
vi.mock('next-intl/server', () => ({
  getTranslations: ({ locale, namespace }: { locale: 'es' | 'en'; namespace: 'metadata' }) =>
    Promise.resolve(createTranslator({ locale, messages: locale === 'en' ? en : es, namespace })),
}));

const { default: LocaleLayout, generateMetadata } = await import('../src/app/[locale]/layout');
// Recorded now: Vitest clears mock history between tests, and next/font is called at import.
const fontCalls = [...mocks.inter.mock.calls];
const { ApiClientProvider } = await import('../src/lib/api-client-provider');
const { ThemeProvider } = await import('../src/components/theme-provider');
const { THEME_SCRIPT } = await import('../src/lib/theme');
const { ServiceWorkerRegistrar } = await import('../src/components/service-worker-registrar');

type Props = LayoutProps<'/[locale]'>;

function props(locale: string): Props {
  return { children: <p>page</p>, params: Promise.resolve({ locale }) };
}

/** Depth-first search of a returned (not rendered) element tree. */
function findElement(node: ReactNode, type: unknown): ReactElement | undefined {
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === type) return node;
  const children = [node.props.children].flat();
  for (const child of children) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return undefined;
}

/** Every string prop and child of a returned (not rendered) element tree. */
function stringsOf(node: ReactNode): string[] {
  if (typeof node === 'string') return [node];
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return Object.values(node.props).flatMap((value): string[] => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap((child) => stringsOf(child as ReactNode));
    if (isValidElement(value)) return stringsOf(value);
    return [];
  });
}

const NOT_FOUND = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' };

beforeEach(() => {
  mocks.requestHeaders = new Headers();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

type ScriptProps = {
  nonce?: string;
  suppressHydrationWarning?: boolean;
  dangerouslySetInnerHTML?: { __html: string };
};

/** The inline script element of the returned tree (a plain `<script>`, never `next/script`). */
function findScript(node: ReactNode): ReactElement<ScriptProps> | undefined {
  return findElement(node, 'script') as ReactElement<ScriptProps> | undefined;
}

describe('[locale] layout', () => {
  it('renders the document in the requested language', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_ORIGIN', 'https://api.argent.test/');

    const tree = await LocaleLayout(props('en'));

    expect(isValidElement(tree) && tree.type).toBe('html');
    expect((tree as ReactElement<{ lang: string }>).props.lang).toBe('en');
    // Only the API origin reaches the browser, normalized.
    const provider = findElement(tree, ApiClientProvider) as ReactElement<{ apiOrigin: string }>;
    expect(provider.props.apiOrigin).toBe('https://api.argent.test');
  });

  it('mounts the service worker registrar once, outside the page (FR-04)', async () => {
    const tree = await LocaleLayout(props('es'));
    expect(findElement(tree, ServiceWorkerRegistrar)).toBeDefined();
  });

  it('answers 404 for an unsupported locale', async () => {
    await expect(LocaleLayout(props('fr'))).rejects.toMatchObject(NOT_FOUND);
    await expect(generateMetadata(props('fr'))).rejects.toMatchObject(NOT_FOUND);
  });

  it.each([
    ['es', es],
    ['en', en],
  ] as const)('titles the %s pages from the catalog', async (locale, catalog) => {
    await expect(generateMetadata(props(locale))).resolves.toEqual({
      title: catalog.metadata.title,
      description: catalog.metadata.description,
    });
  });
});

describe('[locale] layout design system wiring', () => {
  it('loads Inter through next/font with swap and emits no third-party font URL (AC-03)', async () => {
    const tree = await LocaleLayout(props('en'));

    expect(fontCalls).toHaveLength(1);
    expect(fontCalls[0]).toEqual([
      expect.objectContaining({ display: 'swap', variable: '--font-inter' }),
    ]);
    const html = tree as ReactElement<{ className: string }>;
    expect(html.props.className).toContain('inter-variable');
    expect(stringsOf(tree).join(' ')).not.toMatch(
      /fonts\.googleapis|fonts\.gstatic|https?:\/\/[^"']*font/i,
    );
  });

  it('suppresses the hydration warning on html and mounts the theme provider', async () => {
    const tree = (await LocaleLayout(props('es'))) as ReactElement<{
      suppressHydrationWarning?: boolean;
    }>;

    expect(tree.props.suppressHydrationWarning).toBe(true);
    expect(findElement(tree, ThemeProvider)).toBeDefined();
  });

  it('renders the constant pre-paint script with the nonce from x-nonce (AC-07, R-01)', async () => {
    mocks.requestHeaders = new Headers({ 'x-nonce': 'abc123' });

    const script = findScript(await LocaleLayout(props('en')));

    expect(script?.props.nonce).toBe('abc123');
    expect(script?.props.suppressHydrationWarning).toBe(true);
    expect(script?.props.dangerouslySetInnerHTML?.__html).toBe(THEME_SCRIPT);
  });

  it('falls back to the nonce in the request Content-Security-Policy header (R-05)', async () => {
    mocks.requestHeaders = new Headers({
      'content-security-policy': `default-src 'self'; script-src 'self' 'nonce-fromcsp==' 'strict-dynamic'`,
    });

    const script = findScript(await LocaleLayout(props('en')));

    expect(script?.props.nonce).toBe('fromcsp==');
  });

  it('prefers x-nonce over the CSP header', async () => {
    mocks.requestHeaders = new Headers({
      'x-nonce': 'header',
      'content-security-policy': `script-src 'nonce-csp'`,
    });

    expect(findScript(await LocaleLayout(props('en')))?.props.nonce).toBe('header');
  });

  it('emits no inline script and still renders without any nonce (R-05)', async () => {
    mocks.requestHeaders = new Headers({ 'content-security-policy': `default-src 'self'` });

    const tree = await LocaleLayout(props('en'));

    expect(findScript(tree)).toBeUndefined();
    expect(findElement(tree, ApiClientProvider)).toBeDefined();
    expect(findElement(tree, ThemeProvider)).toBeDefined();
    expect(stringsOf(tree).join(' ')).not.toContain(THEME_SCRIPT);
  });
});
