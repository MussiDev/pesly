// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import CheckYourEmailPage from '../src/app/[locale]/(auth)/check-your-email/page';
import ForgotPasswordPage from '../src/app/[locale]/(auth)/forgot-password/page';
import AuthLayout from '../src/app/[locale]/(auth)/layout';
import RegisterPage from '../src/app/[locale]/(auth)/register/page';
import ResetPasswordPage from '../src/app/[locale]/(auth)/reset-password/page';
import SignInPage from '../src/app/[locale]/(auth)/sign-in/page';
import SecondFactorPage from '../src/app/[locale]/(auth)/sign-in/second-factor/page';
import VerifyEmailPage from '../src/app/[locale]/(auth)/verify-email/page';
import { ForgotPasswordForm } from '../src/features/auth/components/forgot-password-form';
import { GoogleSignInButton } from '../src/features/auth/components/google-sign-in-button';
import { RegisterForm } from '../src/features/auth/components/register-form';
import { ResetPasswordForm } from '../src/features/auth/components/reset-password-form';
import { SecondFactorForm } from '../src/features/auth/components/second-factor-form';
import { SignInForm } from '../src/features/auth/components/sign-in-form';
import {
  VerifyEmailNotice,
  VerifyEmailStatus,
} from '../src/features/auth/components/verify-email-notice';
import { CATALOGS, renderApp, stubApi, VALID_TOKEN } from './support/render-app';

const { es, en } = CATALOGS;

const PAGES: [string, string, ComponentType][] = [
  ['/sign-in', 'sign-in', SignInPage],
  ['/sign-in/second-factor', 'second-factor', SecondFactorPage],
  ['/register', 'register', RegisterPage],
  ['/forgot-password', 'forgot-password', ForgotPasswordPage],
  ['/reset-password', 'reset-password', ResetPasswordPage],
  ['/check-your-email', 'check-your-email', CheckYourEmailPage],
  ['/verify-email', 'verify-email', VerifyEmailPage],
];

const GOOGLE_URL = 'http://api.argent.test/auth/google/start?timeZone=UTC&language=es';
const noop = vi.fn();

const SCREENS: [string, () => ReactElement][] = [
  ['sign-in', () => <SignInForm pending={false} errors={{}} onSubmit={noop} />],
  [
    'sign-in with google',
    () => <SignInForm pending={false} errors={{}} googleStartUrl={GOOGLE_URL} onSubmit={noop} />,
  ],
  ['register', () => <RegisterForm pending={false} errors={{}} onSubmit={noop} />],
  ['forgot-password', () => <ForgotPasswordForm pending={false} errors={{}} onSubmit={noop} />],
  ['reset-password', () => <ResetPasswordForm pending={false} errors={{}} onSubmit={noop} />],
  [
    'second-factor',
    () => (
      <SecondFactorForm
        mode="totp"
        pending={false}
        errors={{}}
        onSubmit={noop}
        onModeChange={noop}
      />
    ),
  ],
  ['check-your-email', () => <VerifyEmailNotice resendStatus="idle" errors={{}} onResend={noop} />],
  [
    'verify-email failed',
    () => <VerifyEmailStatus status="failed" resendStatus="idle" errors={{}} onResend={noop} />,
  ],
];

describe('auth layout', () => {
  it.each(PAGES)('%s renders the wordmark above a Card inside main', (path, _name, Page) => {
    window.history.replaceState(null, '', `/es${path}?token=${VALID_TOKEN}`);
    stubApi({});
    renderApp(
      <AuthLayout>
        <Page />
      </AuthLayout>,
    );

    const main = screen.getByRole('main');
    const wordmark = within(main).getByText(es.app.brand);
    const card = main.querySelector('[data-slot="card"]');
    expect(card, 'the screen sits in a Card').not.toBeNull();
    expect(
      wordmark.compareDocumentPosition(card as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the wordmark comes before the card',
    ).toBeTruthy();
    expect(card?.contains(wordmark)).toBe(false);
  });

  it('shows a navy brand mark with the initial next to the wordmark (AC-34)', () => {
    renderApp(
      <AuthLayout>
        <p>child</p>
      </AuthLayout>,
    );

    const mark = document.querySelector('[data-slot="brand-mark"]');
    expect(mark?.textContent).toBe(es.app.brand.charAt(0));
    expect(mark?.className).toMatch(/rounded-xl/);
    expect(mark?.className).toMatch(/bg-primary/);
  });

  it('takes the wordmark from the catalog in both languages', () => {
    renderApp(
      <AuthLayout>
        <p>child</p>
      </AuthLayout>,
      { locale: 'en' },
    );

    expect(screen.getByText(en.app.brand)).toBeDefined();
    expect('brand' in en.auth).toBe(false);
    expect('brand' in es.auth).toBe(false);
  });
});

describe('auth screens use the design system', () => {
  it.each(SCREENS)(
    '%s: sits in one Card and carries the min-h-11 class contract',
    (_name, render) => {
      const { container } = renderApp(render());

      expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
      for (const target of container.querySelectorAll('a, button, input')) {
        const label = target.textContent || target.getAttribute('name') || target.tagName;
        expect(
          /\b(min-h-11|size-11)\b/.test(target.className),
          `"${label}" carries the min-h-11 class contract`,
        ).toBe(true);
      }
    },
  );

  it.each(['sign-in', 'register', 'forgot-password', 'reset-password', 'second-factor'])(
    '%s has exactly one submit button',
    (name) => {
      const render = SCREENS.find(([screen]) => screen === name)?.[1];
      if (!render) throw new Error(`unknown screen ${name}`);
      renderApp(render());

      const submits = screen
        .getAllByRole('button')
        .filter((button) => button.getAttribute('type') === 'submit');
      expect(submits).toHaveLength(1);
    },
  );

  it('keeps the inline link inside its sentence with a text space before it', () => {
    renderApp(<SignInForm pending={false} errors={{}} onSubmit={noop} />);

    const link = screen.getByRole('link', { name: es.auth.signIn.registerLink });
    expect(link.parentElement?.textContent).toBe(
      `${es.auth.signIn.noAccount} ${es.auth.signIn.registerLink}`,
    );
    expect(link.className).toContain('px-0');
  });

  it('separates Google from the email form with a decorative divider', () => {
    renderApp(
      <SignInForm pending={false} errors={{}} googleStartUrl={GOOGLE_URL} onSubmit={noop} />,
    );

    expect(screen.queryByRole('separator')).toBeNull();
    const google = screen.getByRole('link', { name: es.auth.google.continue });
    const divider = google.nextElementSibling as HTMLElement;
    expect(divider.getAttribute('aria-hidden'), 'the row is hidden from assistive tech').toBe(
      'true',
    );
    expect(divider.textContent).toContain(es.auth.or);
    const email = screen.getByLabelText(es.auth.fields.email);
    expect(
      google.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the divider follows the Google button',
    ).toBeTruthy();
    expect(
      divider.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the email field follows the divider',
    ).toBeTruthy();
  });

  it('keeps the Google logo brand fills and a quiet outline button', () => {
    renderApp(<GoogleSignInButton href={GOOGLE_URL} />);

    const link = screen.getByRole('link', { name: es.auth.google.continue });
    expect(link.className).toContain('border');
    expect(link.className).not.toContain('bg-primary');
    const fills = [...link.querySelectorAll('path')].map((path) => path.getAttribute('fill'));
    expect(fills).toEqual(['#EA4335', '#4285F4', '#FBBC05', '#34A853']);
  });

  it('uses theme tokens only: no colour literal besides the Google logo, no arbitrary values', () => {
    const root = join(__dirname, '..', 'src');
    const files = [
      'app/[locale]/(auth)/layout.tsx',
      ...[
        'sign-in-form',
        'register-form',
        'forgot-password-form',
        'reset-password-form',
        'second-factor-form',
        'verify-email-notice',
      ].map((name) => `features/auth/components/${name}.tsx`),
      ...PAGES.map(([, dir]) =>
        dir === 'second-factor'
          ? 'app/[locale]/(auth)/sign-in/second-factor/page.tsx'
          : `app/[locale]/(auth)/${dir}/page.tsx`,
      ),
      'features/auth/components/google-sign-in-button.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(join(root, file), 'utf8');
      const code = file.endsWith('google-sign-in-button.tsx')
        ? source.replace(/fill="#[0-9A-F]{6}"/g, '')
        : source;
      expect(code, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgb\(|\bhsl\(|\boklch\(/);
      expect(code, file).not.toMatch(
        /\b(text|bg|border|ring|p[xytblr]?|m[xytblr]?|gap|w|h|size|min-w|min-h|rounded|shadow)-\[/,
      );
      expect(code, file).not.toMatch(/<(button|input|select)\b/);
    }
  });
});

describe('sign-in failure (sad path preserved)', () => {
  it('shows the error alert for a failed sign-in', async () => {
    window.history.replaceState(null, '', '/es/sign-in');
    stubApi({ 'POST /auth/sign-in': { status: 401, body: { code: 'INVALID_CREDENTIALS' } } });
    renderApp(
      <AuthLayout>
        <SignInPage />
      </AuthLayout>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(es.auth.fields.email), 'ana@example.com');
    await user.type(screen.getByLabelText(es.auth.fields.password), 'a-long-enough-password');
    await user.click(screen.getByRole('button', { name: es.auth.signIn.submit }));

    expect((await screen.findByRole('alert')).textContent).toContain(es.errors.invalidCredentials);
  });

  it('focuses the first invalid field and keeps its message', async () => {
    window.history.replaceState(null, '', '/es/sign-in');
    stubApi({});
    renderApp(
      <AuthLayout>
        <SignInPage />
      </AuthLayout>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: es.auth.signIn.submit }));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(es.auth.fields.email));
    });
    expect(screen.getByLabelText(es.auth.fields.email).getAttribute('aria-invalid')).toBe('true');
  });
});
