// @vitest-environment happy-dom
import {
  DISPLAY_CURRENCY_VALUES,
  LANGUAGE_VALUES,
  RATE_TYPES,
  type ProfileResponse,
} from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ProfileContainer } from '../src/features/profile/containers/profile-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;

const PREFERENCES: ProfileResponse['preferences'] = {
  defaultRateType: 'blue',
  displayCurrency: 'ARS',
  timeZone: 'America/Argentina/Buenos_Aires',
  language: 'es',
};

function profile(
  overrides: {
    displayName?: string | null;
    twoFactorEnabled?: boolean;
    deletionReauth?: 'password' | 'google';
  } = {},
  preferences: Partial<ProfileResponse['preferences']> = {},
) {
  return {
    status: 200,
    body: {
      displayName: 'Ana',
      email: 'ana@example.com',
      twoFactorEnabled: false,
      deletionReauth: 'password',
      ...overrides,
      preferences: { ...PREFERENCES, ...preferences },
    },
  };
}

function failure(status: number, code: string) {
  return { status, body: { code } };
}

function patches(calls: { method: string; body: unknown }[]) {
  return calls.filter((call) => call.method === 'PATCH');
}

const nameField = () => screen.getByLabelText<HTMLInputElement>(es.profile.account.displayName);
const select = (label: string) => screen.getByLabelText<HTMLSelectElement>(label);

async function loaded() {
  await screen.findByLabelText(es.profile.account.displayName);
}

describe('ProfileContainer', () => {
  it('links to the delete-account screen (FR-01)', async () => {
    stubApi({ 'GET /profile': profile() });
    renderApp(<ProfileContainer />);
    await loaded();

    const link = screen.getByRole('link', { name: es.profile.deleteAccount.link });
    expect(link.getAttribute('href')).toBe('/es/settings/delete-account');
    expect(screen.getByText(es.profile.deleteAccount.description)).toBeDefined();
  });

  it('loads the profile once and shows its data (AC-01)', async () => {
    const { calls } = stubApi({ 'GET /profile': profile() });
    renderApp(<ProfileContainer />);

    expect(screen.getByText(es.app.loading)).toBeDefined();
    await loaded();
    expect(nameField().value).toBe('Ana');
    expect(screen.getByText('ana@example.com')).toBeDefined();
    expect(screen.getByText(es.profile.account.twoFactorOff)).toBeDefined();
    expect(select(es.profile.preferences.defaultRateType).value).toBe('blue');
    expect(select(es.profile.preferences.displayCurrency).value).toBe('ARS');
    expect(select(es.profile.preferences.timeZone).value).toBe('America/Argentina/Buenos_Aires');
    expect(select(es.profile.preferences.language).value).toBe('es');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /profile']);
  });

  it('shows 2FA as enabled when the API says so (AC-01)', async () => {
    stubApi({ 'GET /profile': profile({ twoFactorEnabled: true }) });
    renderApp(<ProfileContainer />);

    await loaded();
    expect(screen.getByText(es.profile.account.twoFactorOn)).toBeDefined();
    expect(screen.queryByText(es.profile.account.twoFactorOff)).toBeNull();
  });

  it('shows an empty display name field when the API sends null (AC-01)', async () => {
    stubApi({ 'GET /profile': profile({ displayName: null }) });
    renderApp(<ProfileContainer />);

    await loaded();
    expect(nameField().value).toBe('');
  });

  it('saves a name sending only that field, and shows it afterwards (AC-02)', async () => {
    const { calls } = stubApi({
      'GET /profile': profile(),
      'PATCH /profile': profile({ displayName: 'Ana María' }),
    });
    renderApp(<ProfileContainer />);
    await loaded();
    const user = userEvent.setup();

    await user.clear(nameField());
    await user.type(nameField(), '  Ana María  ');
    await user.click(screen.getByRole('button', { name: es.profile.account.submit }));

    expect(await screen.findByText(es.profile.saved)).toBeDefined();
    expect(patches(calls).map((call) => call.body)).toEqual([{ displayName: 'Ana María' }]);
    expect(nameField().value).toBe('Ana María');
  });

  it('accepts a 1-character and a 50-character name (AC-02)', async () => {
    const { calls } = stubApi({ 'GET /profile': profile(), 'PATCH /profile': profile() });
    renderApp(<ProfileContainer />);
    await loaded();
    const user = userEvent.setup();

    for (const value of ['A', 'B'.repeat(50)]) {
      await user.clear(nameField());
      await user.type(nameField(), value);
      await user.click(screen.getByRole('button', { name: es.profile.account.submit }));
      await screen.findByText(es.profile.saved);
    }
    expect(patches(calls).map((call) => call.body)).toEqual([
      { displayName: 'A' },
      { displayName: 'B'.repeat(50) },
    ]);
  });

  it.each([
    ['empty', '', es.profile.errors.displayNameRequired],
    ['whitespace-only', '   ', es.profile.errors.displayNameRequired],
    ['51 characters', 'a'.repeat(51), es.profile.errors.displayNameTooLong],
  ])(
    'rejects a %s name on the client, with a field message and no request (AC-03)',
    async (_label, value, message) => {
      const { calls } = stubApi({ 'GET /profile': profile() });
      renderApp(<ProfileContainer />);
      await loaded();
      const user = userEvent.setup();

      await user.clear(nameField());
      if (value) await user.type(nameField(), value);
      await user.click(screen.getByRole('button', { name: es.profile.account.submit }));

      expect(await screen.findByText(message)).toBeDefined();
      expect(nameField().getAttribute('aria-invalid')).toBe('true');
      expect(patches(calls)).toEqual([]);
    },
  );

  it('shows a 400 as the generic message above the form and keeps the previous name (AC-03)', async () => {
    const { calls } = stubApi({
      'GET /profile': profile(),
      'PATCH /profile': failure(400, 'VALIDATION_FAILED'),
    });
    renderApp(<ProfileContainer />);
    await loaded();
    const user = userEvent.setup();

    await user.clear(nameField());
    await user.type(nameField(), 'Beatriz');
    await user.click(screen.getByRole('button', { name: es.profile.account.submit }));

    const alert = await screen.findByText(es.errors.validationFailed);
    const form = nameField().closest('form');
    expect(form?.contains(alert)).toBe(true);
    expect(
      alert.compareDocumentPosition(nameField()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(nameField().value).toBe('Ana');
    expect(screen.queryByText(es.profile.saved)).toBeNull();
    expect(patches(calls)).toHaveLength(1);
  });

  it('keeps what was typed after a network failure so the form can be resubmitted', async () => {
    const { calls } = stubApi({
      'GET /profile': profile(),
      'PATCH /profile': ['network-error', profile({ displayName: 'Beatriz' })],
    });
    renderApp(<ProfileContainer />);
    await loaded();
    const user = userEvent.setup();

    await user.clear(nameField());
    await user.type(nameField(), 'Beatriz');
    await user.click(screen.getByRole('button', { name: es.profile.account.submit }));
    expect(await screen.findByText(es.errors.network)).toBeDefined();
    expect(nameField().value).toBe('Beatriz');

    await user.click(screen.getByRole('button', { name: es.profile.account.submit }));
    expect(await screen.findByText(es.profile.saved)).toBeDefined();
    expect(screen.queryByText(es.errors.network)).toBeNull();
    expect(patches(calls)).toHaveLength(2);
  });

  it('renders the email as plain text with no control, and never sends it (AC-04, FR-03)', async () => {
    const { calls } = stubApi({
      'GET /profile': profile(),
      'PATCH /profile': profile({ displayName: 'Bea' }, { displayCurrency: 'USD' }),
    });
    renderApp(<ProfileContainer />);
    await loaded();
    const user = userEvent.setup();

    const email = screen.getByText('ana@example.com');
    expect(['INPUT', 'TEXTAREA', 'SELECT']).not.toContain(email.tagName);
    expect(email.closest('input, textarea, select, [contenteditable]')).toBeNull();
    expect(screen.queryByDisplayValue('ana@example.com')).toBeNull();
    expect(screen.queryByLabelText(es.profile.account.email)).toBeNull();

    await user.clear(nameField());
    await user.type(nameField(), 'Bea');
    await user.click(screen.getByRole('button', { name: es.profile.account.submit }));
    await screen.findByText(es.profile.saved);
    await user.selectOptions(select(es.profile.preferences.displayCurrency), 'USD');
    await user.click(screen.getByRole('button', { name: es.profile.preferences.submit }));
    await waitFor(() => {
      expect(patches(calls)).toHaveLength(2);
    });
    for (const call of patches(calls)) expect(call.body).not.toHaveProperty('email');
  });

  it('lists exactly the allowed rate types, currencies and languages (AC-05, AC-06, FR-07)', async () => {
    stubApi({ 'GET /profile': profile() });
    renderApp(<ProfileContainer />);
    await loaded();

    const values = (label: string) =>
      within(select(label))
        .getAllByRole('option')
        .map((option) => option.getAttribute('value'));
    expect(values(es.profile.preferences.defaultRateType)).toEqual([...RATE_TYPES]);
    expect(values(es.profile.preferences.displayCurrency)).toEqual([...DISPLAY_CURRENCY_VALUES]);
    expect(values(es.profile.preferences.language)).toEqual([...LANGUAGE_VALUES]);
    expect(values(es.profile.preferences.timeZone)).toContain('Europe/Madrid');
  });

  it('adds a saved time zone the runtime does not list to the time zone select', async () => {
    stubApi({ 'GET /profile': profile({}, { timeZone: '+01:00' }) });
    renderApp(<ProfileContainer />);
    await loaded();

    expect(select(es.profile.preferences.timeZone).value).toBe('+01:00');
  });

  it.each([
    [
      'default rate type',
      es.profile.preferences.defaultRateType,
      'mep',
      { defaultRateType: 'mep' },
    ],
    ['display currency', es.profile.preferences.displayCurrency, 'USD', { displayCurrency: 'USD' }],
    ['time zone', es.profile.preferences.timeZone, 'Europe/Madrid', { timeZone: 'Europe/Madrid' }],
  ] as const)(
    'saves the chosen %s sending only that field (AC-05, AC-06, AC-07)',
    async (_name, label, option, body) => {
      const { calls } = stubApi({
        'GET /profile': profile(),
        'PATCH /profile': profile({}, body),
      });
      renderApp(<ProfileContainer />);
      await loaded();
      const user = userEvent.setup();

      await user.selectOptions(select(label), option);
      await user.click(screen.getByRole('button', { name: es.profile.preferences.submit }));

      expect(await screen.findByText(es.profile.saved)).toBeDefined();
      expect(patches(calls).map((call) => call.body)).toEqual([body]);
      expect(select(label).value).toBe(option);
    },
  );

  it('sends no request when nothing changed', async () => {
    const { calls } = stubApi({ 'GET /profile': profile() });
    renderApp(<ProfileContainer />);
    await loaded();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: es.profile.preferences.submit }));
    await user.click(screen.getByRole('button', { name: es.profile.account.submit }));

    expect(patches(calls)).toEqual([]);
  });

  it('shows a 400 for an invalid time zone as the generic message and keeps the previous value (AC-08)', async () => {
    stubApi({
      'GET /profile': profile(),
      'PATCH /profile': failure(400, 'VALIDATION_FAILED'),
    });
    renderApp(<ProfileContainer />);
    await loaded();
    const user = userEvent.setup();

    await user.selectOptions(select(es.profile.preferences.timeZone), 'Europe/Madrid');
    await user.click(screen.getByRole('button', { name: es.profile.preferences.submit }));

    const alert = await screen.findByText(es.errors.validationFailed);
    expect(select(es.profile.preferences.timeZone).closest('form')?.contains(alert)).toBe(true);
    expect(select(es.profile.preferences.timeZone).value).toBe('America/Argentina/Buenos_Aires');
  });

  it('moves to the saved language route after switching the language (AC-09)', async () => {
    const { calls } = stubApi({
      'GET /profile': profile(),
      'PATCH /profile': profile({}, { language: 'en' }),
    });
    const { router } = renderApp(<ProfileContainer />, { pathname: '/es/settings/profile' });
    await loaded();
    const user = userEvent.setup();

    await user.selectOptions(select(es.profile.preferences.language), 'en');
    await user.click(screen.getByRole('button', { name: es.profile.preferences.submit }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/settings/profile');
    });
    expect(patches(calls).map((call) => call.body)).toEqual([{ language: 'en' }]);
  });

  it('does not navigate when the saved language is the current one (AC-09)', async () => {
    stubApi({
      'GET /profile': profile(),
      'PATCH /profile': profile({}, { displayCurrency: 'USD' }),
    });
    const { router } = renderApp(<ProfileContainer />, { pathname: '/es/settings/profile' });
    await loaded();
    const user = userEvent.setup();

    await user.selectOptions(select(es.profile.preferences.displayCurrency), 'USD');
    await user.click(screen.getByRole('button', { name: es.profile.preferences.submit }));

    await screen.findByText(es.profile.saved);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows every string of the screen from the English catalog in the en locale (AC-09)', async () => {
    stubApi({ 'GET /profile': profile({ twoFactorEnabled: true }, { language: 'en' }) });
    renderApp(<ProfileContainer />, { locale: 'en', pathname: '/en/settings/profile' });

    await screen.findByLabelText(en.profile.account.displayName);
    for (const text of [
      en.profile.account.title,
      en.profile.account.email,
      en.profile.account.twoFactor,
      en.profile.account.twoFactorOn,
      en.profile.preferences.title,
    ]) {
      expect(screen.getByText(text)).toBeDefined();
    }
    expect(screen.getByRole('button', { name: en.profile.account.submit })).toBeDefined();
    expect(screen.getByRole('button', { name: en.profile.preferences.submit })).toBeDefined();
    expect(screen.getByRole('option', { name: en.profile.rateTypes.oficial })).toBeDefined();
    expect(screen.getByRole('option', { name: en.profile.currencies.USD })).toBeDefined();
    expect(screen.queryByText(es.profile.account.title)).toBeNull();
  });

  it('sends an expired session to sign-in when loading (sad path)', async () => {
    stubApi({ 'GET /profile': failure(401, 'UNAUTHENTICATED') });
    const { router } = renderApp(<ProfileContainer />);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });

  it('sends an expired session to sign-in when saving (sad path)', async () => {
    stubApi({
      'GET /profile': profile(),
      'PATCH /profile': failure(401, 'UNAUTHENTICATED'),
    });
    const { router } = renderApp(<ProfileContainer />);
    await loaded();
    const user = userEvent.setup();

    await user.selectOptions(select(es.profile.preferences.displayCurrency), 'USD');
    await user.click(screen.getByRole('button', { name: es.profile.preferences.submit }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });

  it('shows a skeleton with a loading status while the profile loads (AC-21)', async () => {
    stubApi({ 'GET /profile': profile() });
    renderApp(<ProfileContainer />);

    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toBe(es.app.loading);
    expect(status.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    await loaded();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the load failure in the shared error state, with no stale form (sad path)', async () => {
    stubApi({ 'GET /profile': 'network-error' });
    renderApp(<ProfileContainer />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(es.ui.error.title);
    expect(alert.textContent).toContain(es.errors.network);
    expect(screen.getByRole('button', { name: es.app.retry })).toBeDefined();
    expect(screen.queryByLabelText(es.profile.account.displayName)).toBeNull();
  });

  it('gives the delete-account entry the destructive treatment (AC-16)', async () => {
    stubApi({ 'GET /profile': profile() });
    renderApp(<ProfileContainer />);
    await loaded();

    const card = screen
      .getByRole('link', { name: es.profile.deleteAccount.link })
      .closest('[data-slot="card"]');
    expect(card?.className).toContain('border-destructive/40');
    const title = screen.getByRole('heading', { level: 2, name: es.profile.deleteAccount.title });
    expect(title.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(title.textContent).toBe(es.profile.deleteAccount.title);
  });

  it('offers a retry when the profile cannot be loaded (sad path)', async () => {
    const { calls } = stubApi({ 'GET /profile': ['network-error', profile()] });
    renderApp(<ProfileContainer />);

    expect(await screen.findByText(es.errors.network)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: es.app.retry }));

    await loaded();
    expect(nameField().value).toBe('Ana');
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2);
  });

  it('keeps both saves when two requests overlap and resolve out of order (race)', async () => {
    const { fetch } = stubApi({ 'GET /profile': profile() });
    const answer = (
      overrides: Parameters<typeof profile>[0],
      preferences: Parameters<typeof profile>[1],
    ) => new Response(JSON.stringify(profile(overrides, preferences).body), { status: 200 });
    const settle: ((response: Response) => void)[] = [];
    const delegate = fetch.getMockImplementation() ?? (() => Promise.reject(new Error('no stub')));
    fetch.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? new Promise<Response>((resolve) => settle.push(resolve))
        : delegate(url, init),
    );
    renderApp(<ProfileContainer />);
    await loaded();
    const user = userEvent.setup();

    await user.clear(nameField());
    await user.type(nameField(), 'Beto');
    await user.click(screen.getByRole('button', { name: es.profile.account.submit }));
    await user.selectOptions(select(es.profile.preferences.displayCurrency), 'USD');
    await user.click(screen.getByRole('button', { name: es.profile.preferences.submit }));
    await waitFor(() => {
      expect(settle).toHaveLength(2);
    });

    // The preferences save lands first, then the (older) name save.
    settle[1]?.(answer({}, { displayCurrency: 'USD' }));
    await waitFor(() => {
      expect(select(es.profile.preferences.displayCurrency).value).toBe('USD');
    });
    settle[0]?.(answer({ displayName: 'Beto' }, {}));

    await waitFor(() => {
      expect(nameField().value).toBe('Beto');
    });
    expect(select(es.profile.preferences.displayCurrency).value).toBe('USD');

    // The saved state must hold both: re-submitting the saved currency is not a change, so no
    // third request goes out (a stale snapshot would read ARS and send it again).
    await user.click(screen.getByRole('button', { name: es.profile.preferences.submit }));
    await waitFor(() => {
      expect(select(es.profile.preferences.displayCurrency).value).toBe('USD');
    });
    expect(settle).toHaveLength(2);
  });
});
