import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { Inter } from 'next/font/google';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ServiceWorkerRegistrar } from '@/components/service-worker-registrar';
import { ThemeProvider } from '@/components/theme-provider';
import { routing } from '@/i18n/routing';
import { ApiClientProvider } from '@/lib/api-client-provider';
import { THEME_SCRIPT } from '@/lib/theme';
import { parseWebEnv } from '@/lib/web-env';
import '../globals.css';

// Downloaded at build time and served from the app's own origin, so `font-src 'self'` holds.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

// Pages render per request so the CSP nonce from `proxy.ts` can be applied to Next.js' scripts.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: LayoutProps<'/[locale]'>): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: 'metadata' });
  return { title: t('title'), description: t('description') };
}

/** `proxy.ts` sets `x-nonce`; the nonce inside the request CSP is the fallback Next.js itself uses. */
function requestNonce(requestHeaders: Headers): string | undefined {
  const direct = requestHeaders.get('x-nonce');
  if (direct) return direct;
  return /'nonce-([^']+)'/.exec(requestHeaders.get('content-security-policy') ?? '')?.[1];
}

export default async function LocaleLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  // Only the API's origin reaches the browser; every API call is made client-side from there.
  const apiOrigin = parseWebEnv(process.env).API_ORIGIN ?? '';
  const nonce = requestNonce(await headers());

  return (
    <html lang={locale} className={inter.variable} suppressHydrationWarning>
      <head>
        {nonce ? (
          // A plain script, not next/script: it must run before first paint. The browser hides the
          // nonce attribute from the client render, hence the suppressed hydration warning.
          <script
            nonce={nonce}
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
          />
        ) : null}
      </head>
      <body className="bg-background text-foreground min-h-dvh antialiased">
        <NextIntlClientProvider>
          <ThemeProvider>
            <ApiClientProvider apiOrigin={apiOrigin}>{children}</ApiClientProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
