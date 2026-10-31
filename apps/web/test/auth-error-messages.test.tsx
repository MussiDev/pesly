import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { RegisterForm } from '../src/features/auth/components/register-form';
import { SignInForm } from '../src/features/auth/components/sign-in-form';
import { ForgotPasswordForm } from '../src/features/auth/components/forgot-password-form';
import { toFormErrors } from '../src/features/auth/form-errors';
import { createApiClient, type FetchLike } from '../src/lib/api-client';

const CATALOGS = { es, en } as const;

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&#x27;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replace(/\s+/g, ' ');
}

function render(locale: keyof typeof CATALOGS, element: ReactElement): string {
  return textOf(
    renderToStaticMarkup(
      <NextIntlClientProvider locale={locale} messages={CATALOGS[locale]}>
        {element}
      </NextIntlClientProvider>,
    ),
  );
}

function apiAnswering(response: Response | Error) {
  const fetch = vi.fn<FetchLike>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  return createApiClient({ baseUrl: 'http://api.argent.test', fetch });
}

function errorResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const noop = () => undefined;

const GOOGLE_START_URL = 'http://api.argent.test/auth/google/start?language=es';

describe('auth forms show API failures', () => {
  it.each([
    [429, 'RATE_LIMITED'],
    [503, 'PASSWORD_CHECK_UNAVAILABLE'],
  ] as const)('%i %s shows the retry-later message on registration', async (status, code) => {
    const result = await apiAnswering(errorResponse(status, code)).register({
      displayName: 'Ana',
      email: 'ana@example.com',
      password: 'correct horse battery',
    });
    if (result.ok) throw new Error('expected a failure');
    const errors = toFormErrors(result);

    for (const locale of ['es', 'en'] as const) {
      const text = render(locale, <RegisterForm pending={false} errors={errors} onSubmit={noop} />);
      expect(text).toContain(CATALOGS[locale].errors.retryLater);
    }
  });

  it('RATE_LIMITED shows the retry-later message on sign-in', async () => {
    const result = await apiAnswering(errorResponse(429, 'RATE_LIMITED')).signIn({
      email: 'ana@example.com',
      password: 'correct horse battery',
    });
    if (result.ok) throw new Error('expected a failure');

    const text = render(
      'es',
      <SignInForm pending={false} errors={toFormErrors(result)} onSubmit={noop} />,
    );

    expect(text).toContain(es.errors.retryLater);
  });

  it('a network failure shows the generic retry message', async () => {
    const result = await apiAnswering(new TypeError('Failed to fetch')).requestPasswordReset({
      email: 'ana@example.com',
    });
    if (result.ok) throw new Error('expected a failure');
    const errors = toFormErrors(result);

    for (const locale of ['es', 'en'] as const) {
      const signIn = render(locale, <SignInForm pending={false} errors={errors} onSubmit={noop} />);
      const forgot = render(
        locale,
        <ForgotPasswordForm pending={false} errors={errors} onSubmit={noop} />,
      );
      expect(signIn).toContain(CATALOGS[locale].errors.network);
      expect(forgot).toContain(CATALOGS[locale].errors.network);
    }
  });

  it('shows the form without any error when there is none', () => {
    const text = render('es', <SignInForm pending={false} errors={{}} onSubmit={noop} />);

    expect(text).toContain(es.auth.signIn.submit);
    expect(text).not.toContain(es.errors.retryLater);
    expect(text).not.toContain(es.errors.network);
  });

  it('shows the Google sign-in failure in both languages (AC-02, AC-05, AC-08, AC-09)', () => {
    for (const locale of ['es', 'en'] as const) {
      const text = render(
        locale,
        <SignInForm
          pending={false}
          errors={{ form: 'googleFailed' }}
          onSubmit={noop}
          googleStartUrl={GOOGLE_START_URL}
        />,
      );
      expect(text).toContain(CATALOGS[locale].errors.googleFailed);
    }
    expect(en.errors.googleFailed).toBe('Google sign-in failed. Please try again.');
    expect(es.errors.googleFailed).toBe(
      'No pudimos iniciar sesión con Google. Volvé a intentarlo.',
    );
  });

  it.each(['es', 'en'] as const)(
    'both screens offer Google with an "or" divider in %s, only when given a start URL',
    (locale) => {
      const catalog = CATALOGS[locale];
      for (const Form of [SignInForm, RegisterForm]) {
        const withGoogle = render(
          locale,
          <Form pending={false} errors={{}} onSubmit={noop} googleStartUrl={GOOGLE_START_URL} />,
        );
        expect(withGoogle).toContain(catalog.auth.google.continue);
        expect(withGoogle).toContain(` ${catalog.auth.or} `);

        const withoutGoogle = render(locale, <Form pending={false} errors={{}} onSubmit={noop} />);
        expect(withoutGoogle).not.toContain(catalog.auth.google.continue);
      }
    },
  );
});
