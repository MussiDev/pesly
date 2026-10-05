// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import AccountsPage from '../src/app/[locale]/(app)/accounts/page';
import NewAccountPage from '../src/app/[locale]/(app)/accounts/new/page';
import CategoriesPage from '../src/app/[locale]/(app)/categories/page';
import MovementsPage from '../src/app/[locale]/(app)/movements/page';
import NewMovementPage from '../src/app/[locale]/(app)/movements/new/page';
import AppLayout from '../src/app/[locale]/(app)/layout';
import HomePage from '../src/app/[locale]/(app)/page';
import CheckYourEmailPage from '../src/app/[locale]/(auth)/check-your-email/page';
import ForgotPasswordPage from '../src/app/[locale]/(auth)/forgot-password/page';
import AuthLayout from '../src/app/[locale]/(auth)/layout';
import RegisterPage from '../src/app/[locale]/(auth)/register/page';
import ResetPasswordPage from '../src/app/[locale]/(auth)/reset-password/page';
import SignInPage from '../src/app/[locale]/(auth)/sign-in/page';
import SecondFactorPage from '../src/app/[locale]/(auth)/sign-in/second-factor/page';
import DeleteAccountPage from '../src/app/[locale]/(app)/settings/delete-account/page';
import InvestmentsPage from '../src/app/[locale]/(app)/investments/page';
import ProfilePage from '../src/app/[locale]/(app)/settings/profile/page';
import SecurityPage from '../src/app/[locale]/(app)/settings/security/page';
import VerifyEmailPage from '../src/app/[locale]/(auth)/verify-email/page';
import { CATALOGS, renderApp, stubApi, VALID_TOKEN } from './support/render-app';

const { es } = CATALOGS;

const AUTH_PAGES: [string, ComponentType, string][] = [
  ['/register', RegisterPage, es.auth.register.title],
  ['/sign-in', SignInPage, es.auth.signIn.title],
  ['/forgot-password', ForgotPasswordPage, es.auth.forgotPassword.title],
  ['/reset-password', ResetPasswordPage, es.auth.resetPassword.title],
  ['/check-your-email', CheckYourEmailPage, es.auth.checkYourEmail.title],
  ['/verify-email', VerifyEmailPage, es.auth.verifyEmail.title],
  ['/sign-in/second-factor', SecondFactorPage, es.auth.secondFactor.title],
];

const SESSION = {
  status: 200,
  body: {
    user: {
      id: 'u1',
      email: 'ana@example.com',
      emailVerified: true,
      language: 'es',
      timeZone: 'UTC',
    },
  },
};

describe('routes', () => {
  it.each(AUTH_PAGES)('%s shows its screen inside the public auth layout', (path, Page, title) => {
    window.history.replaceState(null, '', `/es${path}?token=${VALID_TOKEN}`);
    stubApi({});
    renderApp(
      <AuthLayout>
        <Page />
      </AuthLayout>,
    );

    const heading = screen.getByRole('heading', { level: 1, name: title });
    expect(heading.closest('main')).not.toBeNull();
  });

  it('the home page is only shown behind the session guard', async () => {
    const { calls } = stubApi({
      'GET /auth/session': SESSION,
      'GET /accounts?archived=false&limit=100': {
        status: 200,
        body: {
          items: [],
          availableTotals: { ARS: '0', USD: '0' },
          netWorthTotals: { ARS: '0', USD: '0' },
          debtTotals: { ARS: '0', USD: '0' },
          creditCardCount: 0,
          total: 0,
          limit: 100,
          offset: 0,
        },
      },
      'GET /movements?limit=5': {
        status: 200,
        body: { items: [], total: 0, limit: 5, offset: 0 },
      },
    });
    renderApp(
      <AppLayout>
        <HomePage />
      </AppLayout>,
    );

    expect(screen.queryByRole('heading', { name: es.home.title })).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: es.home.title })).toBeDefined();
    expect(await screen.findByRole('heading', { name: es.home.empty.title })).toBeDefined();
    const link = screen.getByRole('link', { name: es.home.empty.action });
    expect(link.getAttribute('href')).toBe('/es/accounts/new');
    expect(calls[0]?.path).toBe('/auth/session');
    expect(calls.map((call) => call.path)).toContain('/movements?limit=5');
  });

  it('the accounts list is only shown behind the session guard', async () => {
    const { calls } = stubApi({
      'GET /auth/session': SESSION,
      'GET /accounts?archived=false&limit=100': {
        status: 200,
        body: {
          items: [
            {
              id: 'a1',
              name: 'Caja',
              type: 'cash',
              currency: 'ARS',
              openingBalance: '0',
              balance: '150000',
              includeInAvailable: true,
              archived: false,
              archivedAt: null,
              createdAt: '2026-10-01T00:00:00.000Z',
            },
          ],
          availableTotals: { ARS: '150000', USD: '0' },
          netWorthTotals: { ARS: '150000', USD: '0' },
          debtTotals: { ARS: '0', USD: '0' },
          creditCardCount: 0,
          total: 1,
          limit: 100,
          offset: 0,
        },
      },
    });
    renderApp(
      <AppLayout>
        <AccountsPage />
      </AppLayout>,
    );

    expect(screen.queryByRole('heading', { name: es.accounts.title })).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: es.accounts.title })).toBeDefined();
    expect(await screen.findByRole('listitem', { name: 'Caja' })).toBeDefined();
    expect(calls.map((call) => call.path)).toEqual([
      '/auth/session',
      '/accounts?archived=false&limit=100',
    ]);
  });

  it('the new account form is only shown behind the session guard', async () => {
    stubApi({ 'GET /auth/session': SESSION });
    renderApp(
      <AppLayout>
        <NewAccountPage />
      </AppLayout>,
    );

    expect(screen.queryByRole('heading', { name: es.accounts.new.title })).toBeNull();
    expect(
      await screen.findByRole('heading', { level: 1, name: es.accounts.new.title }),
    ).toBeDefined();
    expect(screen.getByLabelText(es.accounts.fields.name)).toBeDefined();
  });

  it('the movements list is only shown behind the session guard', async () => {
    const empty = { status: 200, body: { items: [], total: 0, limit: 100, offset: 0 } };
    const noAccounts = {
      status: 200,
      body: {
        items: [],
        availableTotals: { ARS: '0', USD: '0' },
        netWorthTotals: { ARS: '0', USD: '0' },
        debtTotals: { ARS: '0', USD: '0' },
        creditCardCount: 0,
        total: 0,
        limit: 100,
        offset: 0,
      },
    };
    stubApi({
      'GET /auth/session': SESSION,
      'GET /profile': {
        status: 200,
        body: {
          displayName: 'Ana',
          email: 'ana@example.com',
          twoFactorEnabled: false,
          deletionReauth: 'password',
          preferences: {
            defaultRateType: 'blue',
            displayCurrency: 'ARS',
            timeZone: 'UTC',
            language: 'es',
          },
        },
      },
      'GET /movements?limit=100': empty,
      'GET /accounts?archived=false&limit=100': noAccounts,
      'GET /accounts?archived=true&limit=100': noAccounts,
      'GET /categories?archived=false&limit=100': empty,
      'GET /categories?archived=true&limit=100': empty,
    });
    renderApp(
      <AppLayout>
        <MovementsPage />
      </AppLayout>,
    );

    expect(screen.queryByRole('heading', { name: es.movements.title })).toBeNull();
    expect(
      await screen.findByRole('heading', { level: 1, name: es.movements.title }),
    ).toBeDefined();
    expect(await screen.findByText(es.movements.list.empty)).toBeDefined();
  });

  it('the new movement form is only shown behind the session guard', async () => {
    stubApi({
      'GET /auth/session': SESSION,
      'GET /profile': {
        status: 200,
        body: {
          displayName: 'Ana',
          email: 'ana@example.com',
          twoFactorEnabled: false,
          deletionReauth: 'password',
          preferences: {
            defaultRateType: 'blue',
            displayCurrency: 'ARS',
            timeZone: 'UTC',
            language: 'es',
          },
        },
      },
      'GET /accounts?archived=false&limit=100': {
        status: 200,
        body: {
          items: [],
          availableTotals: { ARS: '0', USD: '0' },
          netWorthTotals: { ARS: '0', USD: '0' },
          debtTotals: { ARS: '0', USD: '0' },
          creditCardCount: 0,
          total: 0,
          limit: 100,
          offset: 0,
        },
      },
      'GET /categories?archived=false&limit=100': {
        status: 200,
        body: { items: [], total: 0, limit: 100, offset: 0 },
      },
      'GET /exchange-rates/latest': { status: 200, body: { rates: [] } },
    });
    const page = await NewMovementPage({ searchParams: Promise.resolve({}) });
    renderApp(<AppLayout>{page}</AppLayout>);

    expect(screen.queryByRole('heading', { name: es.movements.new.title })).toBeNull();
    expect(
      await screen.findByRole('heading', { level: 1, name: es.movements.new.title }),
    ).toBeDefined();
    expect(screen.getByLabelText(es.movements.fields.amount)).toBeDefined();
  });

  describe('new-movement page: preselected type (AC-14)', () => {
    type Page = ReactElement<{ children: ReactElement<{ initialType: string }> }>;
    const typeOf = async (type: string | string[] | undefined) => {
      const page = (await NewMovementPage({ searchParams: Promise.resolve({ type }) })) as Page;
      return page.props.children.props.initialType;
    };

    it.each(['expense', 'income', 'transfer', 'exchange'])(
      'passes %s from the URL to the screen',
      async (type) => {
        expect(await typeOf(type)).toBe(type);
      },
    );

    it.each([undefined, '', 'nope', 'INCOME', ['income', 'expense']])(
      'error: an absent, unknown or repeated type (%j) starts on expense',
      async (type) => {
        expect(await typeOf(type)).toBe('expense');
      },
    );
  });

  it('renders both accounts screens in English', async () => {
    stubApi({
      'GET /auth/session': SESSION,
      'GET /accounts?archived=false&limit=100': {
        status: 200,
        body: {
          items: [],
          availableTotals: { ARS: '0', USD: '0' },
          netWorthTotals: { ARS: '0', USD: '0' },
          debtTotals: { ARS: '0', USD: '0' },
          creditCardCount: 0,
          total: 0,
          limit: 100,
          offset: 0,
        },
      },
    });
    renderApp(
      <AppLayout>
        <AccountsPage />
      </AppLayout>,
      { locale: 'en' },
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: CATALOGS.en.accounts.title }),
    ).toBeDefined();
    expect(await screen.findByText(CATALOGS.en.accounts.list.empty)).toBeDefined();
  });

  it('the categories screen is only shown behind the session guard', async () => {
    const { calls } = stubApi({
      'GET /auth/session': SESSION,
      'GET /categories?archived=false&limit=100&offset=0': {
        status: 200,
        body: {
          items: [
            {
              id: '00000000-0000-4000-8000-000000000001',
              kind: 'expense',
              parentId: null,
              key: 'food',
              name: null,
              icon: 'utensils',
              color: 'orange',
              archived: false,
              archivedAt: null,
              createdAt: '2026-10-01T00:00:00.000Z',
            },
          ],
          total: 1,
          limit: 100,
          offset: 0,
        },
      },
    });
    renderApp(
      <AppLayout>
        <CategoriesPage />
      </AppLayout>,
    );

    expect(screen.queryByRole('heading', { name: es.categories.title })).toBeNull();
    expect(
      await screen.findByRole('heading', { level: 1, name: es.categories.title }),
    ).toBeDefined();
    expect(await screen.findByRole('listitem', { name: 'Comida' })).toBeDefined();
    expect(calls.map((call) => call.path)).toEqual([
      '/auth/session',
      '/categories?archived=false&limit=100&offset=0',
    ]);
  });

  it('renders the categories screen in English with the English default names', async () => {
    stubApi({
      'GET /auth/session': SESSION,
      'GET /categories?archived=false&limit=100&offset=0': {
        status: 200,
        body: {
          items: [
            {
              id: '00000000-0000-4000-8000-000000000001',
              kind: 'expense',
              parentId: null,
              key: 'food',
              name: null,
              icon: 'utensils',
              color: 'orange',
              archived: false,
              archivedAt: null,
              createdAt: '2026-10-01T00:00:00.000Z',
            },
          ],
          total: 1,
          limit: 100,
          offset: 0,
        },
      },
    });
    renderApp(
      <AppLayout>
        <CategoriesPage />
      </AppLayout>,
      { locale: 'en' },
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: CATALOGS.en.categories.title }),
    ).toBeDefined();
    expect(await screen.findByRole('listitem', { name: 'Food' })).toBeDefined();
  });

  it('the security settings are only shown behind the session guard', async () => {
    const { calls } = stubApi({
      'GET /auth/session': SESSION,
      'GET /auth/2fa': { status: 200, body: { enabled: false, recoveryCodesRemaining: 0 } },
    });
    renderApp(
      <AppLayout>
        <SecurityPage />
      </AppLayout>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: es.security.title })).toBeDefined();
    expect(await screen.findByText(es.security.twoFactor.off)).toBeDefined();
    expect(calls.map((call) => call.path)).toEqual(['/auth/session', '/auth/2fa']);
  });

  it('the delete-account screen is only shown behind the session guard', async () => {
    const { calls } = stubApi({
      'GET /auth/session': SESSION,
      'GET /profile': {
        status: 200,
        body: {
          displayName: null,
          email: 'ana@example.com',
          twoFactorEnabled: false,
          deletionReauth: 'password',
          preferences: {
            defaultRateType: 'blue',
            displayCurrency: 'ARS',
            timeZone: 'UTC',
            language: 'es',
          },
        },
      },
    });
    renderApp(
      <AppLayout>
        <DeleteAccountPage />
      </AppLayout>,
    );

    expect(screen.queryByRole('heading', { name: es.deleteUser.title })).toBeNull();
    expect(
      await screen.findByRole('heading', { level: 1, name: es.deleteUser.title }),
    ).toBeDefined();
    expect(await screen.findByLabelText(es.deleteUser.password)).toBeDefined();
    expect(calls.map((call) => call.path)).toEqual(['/auth/session', '/profile']);
  });

  it('the investments screen is only shown behind the session guard', async () => {
    const { calls } = stubApi({
      'GET /auth/session': SESSION,
      'GET /investments/portfolios': { status: 200, body: { portfolios: [] } },
    });
    renderApp(
      <AppLayout>
        <InvestmentsPage />
      </AppLayout>,
    );

    expect(screen.queryByRole('heading', { name: es.investments.title })).toBeNull();
    expect(
      await screen.findByRole('heading', { level: 1, name: es.investments.title }),
    ).toBeDefined();
    expect(await screen.findByRole('heading', { name: es.investments.empty.title })).toBeDefined();
    expect(calls.map((call) => call.path)).toContain('/investments/portfolios');
    expect(calls[0]?.path).toBe('/auth/session');
  });

  it('the profile screen is only shown behind the session guard', async () => {
    const { calls } = stubApi({
      'GET /auth/session': SESSION,
      'GET /profile': {
        status: 200,
        body: {
          displayName: null,
          email: 'ana@example.com',
          twoFactorEnabled: false,
          deletionReauth: 'password',
          preferences: {
            defaultRateType: 'blue',
            displayCurrency: 'ARS',
            timeZone: 'UTC',
            language: 'es',
          },
        },
      },
    });
    renderApp(
      <AppLayout>
        <ProfilePage />
      </AppLayout>,
    );

    expect(screen.queryByRole('heading', { name: es.profile.title })).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: es.profile.title })).toBeDefined();
    expect(await screen.findByLabelText(es.profile.account.displayName)).toBeDefined();
    expect(calls.map((call) => call.path)).toEqual(['/auth/session', '/profile']);
  });
});
