// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as QRCode from 'qrcode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecuritySettingsContainer } from '../src/features/two-factor/containers/security-settings-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es } = CATALOGS;

const qrCode = vi.hoisted(() => ({ fail: false }));

// The real QR renderer, unless a test makes it fail.
vi.mock('qrcode', async (importOriginal) => {
  const actual = await importOriginal<typeof QRCode>();
  return {
    ...actual,
    toString: (text: string, options: QRCode.QRCodeToStringOptions) =>
      qrCode.fail ? Promise.reject(new Error('cannot render')) : actual.toString(text, options),
  };
});

afterEach(() => {
  qrCode.fail = false;
});

const CODES = Array.from({ length: 10 }, (_, index) => `ABCDE-FGH${index}J`);
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const SETUP = {
  status: 200,
  body: {
    otpauthUri: `otpauth://totp/Pesly:ana%40example.com?secret=${SECRET}&issuer=Pesly`,
    secret: SECRET,
  },
};

function status(enabled: boolean, recoveryCodesRemaining = enabled ? 10 : 0) {
  return { status: 200, body: { enabled, recoveryCodesRemaining } };
}

function failure(httpStatus: number, code: string) {
  return { status: httpStatus, body: { code } };
}

async function startSetup() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: es.security.twoFactor.enable }));
  await screen.findByRole('heading', { name: es.security.setup.title });
  return user;
}

describe('SecuritySettingsContainer', () => {
  it('enables 2FA: QR and secret, then the 10 codes once, until "I saved them" (AC-01, AC-02)', async () => {
    const { calls } = stubApi({
      'GET /auth/2fa': status(false),
      'POST /auth/2fa/setup': SETUP,
      'POST /auth/2fa/enable': { status: 200, body: { recoveryCodes: CODES } },
    });
    renderApp(<SecuritySettingsContainer />);

    expect(await screen.findByText(es.security.twoFactor.off)).toBeDefined();
    const user = await startSetup();

    const qr = screen.getByRole('img', { name: es.security.setup.qrAlt });
    expect(qr.getAttribute('src')?.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(qr.getAttribute('src') ?? '')).toContain('<svg');
    expect(screen.getByText(SECRET)).toBeDefined();

    await user.type(screen.getByLabelText(es.security.setup.code), ' 123456 ');
    await user.click(screen.getByRole('button', { name: es.security.setup.submit }));

    await screen.findByRole('heading', { name: es.security.recoveryCodes.title });
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(CODES);

    await user.click(screen.getByRole('button', { name: es.security.recoveryCodes.copy }));
    expect(await screen.findByText(es.security.recoveryCodes.copied)).toBeDefined();
    expect(await navigator.clipboard.readText()).toBe(CODES.join('\n'));

    await user.click(screen.getByRole('button', { name: es.security.recoveryCodes.done }));

    expect(await screen.findByText(es.security.twoFactor.on)).toBeDefined();
    expect(screen.getByText(es.security.enabledNotice)).toBeDefined();
    expect(screen.queryByText(CODES[0] ?? '')).toBeNull();
    expect(calls).toEqual([
      { method: 'GET', path: '/auth/2fa', body: undefined },
      { method: 'POST', path: '/auth/2fa/setup', body: {} },
      { method: 'POST', path: '/auth/2fa/enable', body: { code: '123456' } },
    ]);
  });

  it('rejects a non-numeric code before sending it (sad path)', async () => {
    const { calls } = stubApi({ 'GET /auth/2fa': status(false), 'POST /auth/2fa/setup': SETUP });
    renderApp(<SecuritySettingsContainer />);
    const user = await startSetup();

    await user.type(screen.getByLabelText(es.security.setup.code), '12a456');
    await user.click(screen.getByRole('button', { name: es.security.setup.submit }));

    expect(await screen.findByText(es.errors.totpCodeFormat)).toBeDefined();
    expect(calls.map((call) => call.path)).not.toContain('/auth/2fa/enable');
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(es.security.setup.code));
    });
  });

  it('keeps the setup open with the field focused when the code is wrong (sad path)', async () => {
    stubApi({
      'GET /auth/2fa': status(false),
      'POST /auth/2fa/setup': SETUP,
      'POST /auth/2fa/enable': failure(400, 'TOTP_INVALID'),
    });
    renderApp(<SecuritySettingsContainer />);
    const user = await startSetup();

    await user.type(screen.getByLabelText(es.security.setup.code), '000000');
    await user.click(screen.getByRole('button', { name: es.security.setup.submit }));

    expect(await screen.findByText(es.errors.codeInvalid)).toBeDefined();
    expect(screen.getByText(SECRET)).toBeDefined();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(es.security.setup.code));
    });
  });

  it('goes back to the status when the pending setup was replaced meanwhile (sad path)', async () => {
    stubApi({
      'GET /auth/2fa': status(false),
      'POST /auth/2fa/setup': SETUP,
      'POST /auth/2fa/enable': failure(409, 'TWO_FACTOR_SETUP_REQUIRED'),
    });
    renderApp(<SecuritySettingsContainer />);
    const user = await startSetup();

    await user.type(screen.getByLabelText(es.security.setup.code), '123456');
    await user.click(screen.getByRole('button', { name: es.security.setup.submit }));

    expect(await screen.findByText(es.errors.twoFactorSetupRequired)).toBeDefined();
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.getByRole('button', { name: es.security.twoFactor.enable })).toBeDefined();
  });

  it('cancels a setup and shows the status again', async () => {
    stubApi({ 'GET /auth/2fa': status(false), 'POST /auth/2fa/setup': SETUP });
    renderApp(<SecuritySettingsContainer />);
    const user = await startSetup();

    await user.click(screen.getByRole('button', { name: es.security.setup.cancel }));

    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.getByRole('button', { name: es.security.twoFactor.enable })).toBeDefined();
  });

  it('shows the retry-later message when 2FA is unavailable (sad path)', async () => {
    stubApi({
      'GET /auth/2fa': status(false),
      'POST /auth/2fa/setup': failure(503, 'TWO_FACTOR_UNAVAILABLE'),
    });
    renderApp(<SecuritySettingsContainer />);

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: es.security.twoFactor.enable }));

    expect(await screen.findByText(es.errors.retryLater)).toBeDefined();
    expect(
      screen.getByRole('button', { name: es.security.twoFactor.enable }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('reloads the status when 2FA was enabled from another session (sad path)', async () => {
    stubApi({
      'GET /auth/2fa': [status(false), status(true, 7)],
      'POST /auth/2fa/setup': failure(409, 'TWO_FACTOR_ALREADY_ENABLED'),
    });
    renderApp(<SecuritySettingsContainer />);

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: es.security.twoFactor.enable }));

    expect(await screen.findByText(es.security.twoFactor.on)).toBeDefined();
    expect(screen.getByText(es.errors.twoFactorAlreadyEnabled)).toBeDefined();
  });

  it('disables 2FA with a recovery code (AC-03)', async () => {
    const { calls } = stubApi({
      'GET /auth/2fa': status(true, 9),
      'POST /auth/2fa/disable': { status: 204 },
    });
    renderApp(<SecuritySettingsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: es.security.twoFactor.disable }));
    await user.type(screen.getByLabelText(es.security.disable.code), 'abcde-fghij');
    await user.click(screen.getByRole('button', { name: es.security.disable.submit }));

    expect(await screen.findByText(es.security.twoFactor.off)).toBeDefined();
    expect(screen.getByText(es.security.disabledNotice)).toBeDefined();
    expect(calls.at(-1)).toEqual({
      method: 'POST',
      path: '/auth/2fa/disable',
      body: { code: 'abcde-fghij' },
    });
  });

  it('refuses a wrong disable code with the field focused, and a malformed one unsent (sad path)', async () => {
    const { calls } = stubApi({
      'GET /auth/2fa': status(true),
      'POST /auth/2fa/disable': failure(400, 'TOTP_INVALID'),
    });
    renderApp(<SecuritySettingsContainer />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: es.security.twoFactor.disable }));
    const input = screen.getByLabelText(es.security.disable.code);

    await user.type(input, 'not a code!');
    await user.click(screen.getByRole('button', { name: es.security.disable.submit }));
    expect(await screen.findByText(es.errors.secondFactorCodeFormat)).toBeDefined();
    expect(calls.map((call) => call.path)).not.toContain('/auth/2fa/disable');

    await user.clear(input);
    await user.type(input, '000000');
    await user.click(screen.getByRole('button', { name: es.security.disable.submit }));
    expect(await screen.findByText(es.errors.codeInvalid)).toBeDefined();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(es.security.disable.code));
    });

    await user.click(screen.getByRole('button', { name: es.security.disable.cancel }));
    expect(screen.getByText(es.security.twoFactor.on)).toBeDefined();
  });

  it('reloads the status when 2FA was already off (sad path)', async () => {
    stubApi({
      'GET /auth/2fa': [status(true), status(false)],
      'POST /auth/2fa/disable': failure(409, 'TWO_FACTOR_NOT_ENABLED'),
    });
    renderApp(<SecuritySettingsContainer />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: es.security.twoFactor.disable }));

    await user.type(screen.getByLabelText(es.security.disable.code), '123456');
    await user.click(screen.getByRole('button', { name: es.security.disable.submit }));

    expect(await screen.findByText(es.security.twoFactor.off)).toBeDefined();
    expect(screen.getByText(es.errors.twoFactorNotEnabled)).toBeDefined();
  });

  it('shows a skeleton with a loading status while the status loads (AC-21)', async () => {
    stubApi({ 'GET /auth/2fa': status(false) });
    renderApp(<SecuritySettingsContainer />);

    const loading = screen.getByRole('status');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.textContent).toBe(es.app.loading);
    expect(loading.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(await screen.findByText(es.security.twoFactor.off)).toBeDefined();
  });

  it('shows a failed status check in the shared error state, with no stale status (sad path)', async () => {
    stubApi({ 'GET /auth/2fa': 'network-error' });
    renderApp(<SecuritySettingsContainer />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(es.ui.error.title);
    expect(alert.textContent).toContain(es.errors.network);
    expect(screen.queryByText(es.security.twoFactor.off)).toBeNull();
    expect(screen.queryByRole('button', { name: es.security.twoFactor.enable })).toBeNull();
  });

  it('shows a failed status check and retries it (sad path)', async () => {
    stubApi({ 'GET /auth/2fa': ['network-error', status(false)] });
    renderApp(<SecuritySettingsContainer />);

    expect(await screen.findByText(es.errors.network)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: es.app.retry }));

    expect(await screen.findByText(es.security.twoFactor.off)).toBeDefined();
  });

  it('sends a signed-out user to sign-in (sad path)', async () => {
    stubApi({
      'GET /auth/2fa': failure(401, 'UNAUTHENTICATED'),
      'POST /auth/refresh': failure(401, 'UNAUTHENTICATED'),
    });
    const { router } = renderApp(<SecuritySettingsContainer />);

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });

  it('reports a QR code that cannot be rendered and lets the user try again (sad path)', async () => {
    stubApi({ 'GET /auth/2fa': status(false), 'POST /auth/2fa/setup': SETUP });
    qrCode.fail = true;
    renderApp(<SecuritySettingsContainer />);

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: es.security.twoFactor.enable }));

    expect(await screen.findByText(es.errors.unexpected)).toBeDefined();
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(
      screen.getByRole('button', { name: es.security.twoFactor.enable }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('keeps the setup when enabling cannot reach the API, and re-reads the status on cancel (sad path)', async () => {
    stubApi({
      // The enable may have committed before the connection dropped: the status says so.
      'GET /auth/2fa': [status(false), status(true)],
      'POST /auth/2fa/setup': SETUP,
      'POST /auth/2fa/enable': 'network-error',
    });
    renderApp(<SecuritySettingsContainer />);
    const user = await startSetup();

    await user.type(screen.getByLabelText(es.security.setup.code), '123456');
    await user.click(screen.getByRole('button', { name: es.security.setup.submit }));

    expect(await screen.findByText(es.errors.network)).toBeDefined();
    expect(screen.getByText(SECRET)).toBeDefined();
    expect(screen.getByRole('img', { name: es.security.setup.qrAlt })).toBeDefined();

    await user.click(screen.getByRole('button', { name: es.security.setup.cancel }));

    expect(await screen.findByText(es.security.twoFactor.on)).toBeDefined();
    expect(screen.queryByText(es.security.twoFactor.off)).toBeNull();
  });

  it('keeps the disable form when rate limited or offline, and re-reads the status on cancel (sad path)', async () => {
    stubApi({
      'GET /auth/2fa': [status(true), status(false)],
      'POST /auth/2fa/disable': [failure(429, 'RATE_LIMITED'), 'network-error'],
    });
    renderApp(<SecuritySettingsContainer />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: es.security.twoFactor.disable }));
    const input = screen.getByLabelText(es.security.disable.code);

    await user.type(input, '123456');
    await user.click(screen.getByRole('button', { name: es.security.disable.submit }));
    expect(await screen.findByText(es.errors.retryLater)).toBeDefined();
    expect(screen.getByRole('heading', { name: es.security.disable.title })).toBeDefined();

    await user.click(screen.getByRole('button', { name: es.security.disable.submit }));
    expect(await screen.findByText(es.errors.network)).toBeDefined();
    expect(screen.getByRole('heading', { name: es.security.disable.title })).toBeDefined();

    await user.click(screen.getByRole('button', { name: es.security.disable.cancel }));
    expect(await screen.findByText(es.security.twoFactor.off)).toBeDefined();
  });

  it('sends the user to sign-in when the session ends during the setup (sad path)', async () => {
    stubApi({
      'GET /auth/2fa': status(false),
      'POST /auth/2fa/setup': failure(401, 'UNAUTHENTICATED'),
      'POST /auth/refresh': failure(401, 'UNAUTHENTICATED'),
    });
    const { router } = renderApp(<SecuritySettingsContainer />);

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: es.security.twoFactor.enable }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });

  it("moves the focus to each new view's heading, but not on the first load", async () => {
    stubApi({
      'GET /auth/2fa': status(false),
      'POST /auth/2fa/setup': SETUP,
      'POST /auth/2fa/enable': { status: 200, body: { recoveryCodes: CODES } },
    });
    renderApp(<SecuritySettingsContainer />);
    const heading = (name: string) => screen.getByRole('heading', { name });

    await screen.findByText(es.security.twoFactor.off);
    expect(document.activeElement).toBe(document.body);

    const user = await startSetup();
    await waitFor(() => {
      expect(document.activeElement).toBe(heading(es.security.setup.title));
    });

    await user.type(screen.getByLabelText(es.security.setup.code), '123456');
    await user.click(screen.getByRole('button', { name: es.security.setup.submit }));
    await screen.findByRole('heading', { name: es.security.recoveryCodes.title });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading(es.security.recoveryCodes.title));
    });

    await user.click(screen.getByRole('button', { name: es.security.recoveryCodes.done }));
    await waitFor(() => {
      expect(document.activeElement).toBe(heading(es.security.twoFactor.title));
    });

    await user.click(screen.getByRole('button', { name: es.security.twoFactor.disable }));
    await waitFor(() => {
      expect(document.activeElement).toBe(heading(es.security.disable.title));
    });
  });

  it('reports a copy that the browser refused (sad path)', async () => {
    stubApi({
      'GET /auth/2fa': status(false),
      'POST /auth/2fa/setup': SETUP,
      'POST /auth/2fa/enable': { status: 200, body: { recoveryCodes: CODES } },
    });
    renderApp(<SecuritySettingsContainer />);
    const user = await startSetup();
    await user.type(screen.getByLabelText(es.security.setup.code), '123456');
    await user.click(screen.getByRole('button', { name: es.security.setup.submit }));
    await screen.findByRole('heading', { name: es.security.recoveryCodes.title });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });

    await user.click(screen.getByRole('button', { name: es.security.recoveryCodes.copy }));

    expect(await screen.findByText(es.security.recoveryCodes.copyFailed)).toBeDefined();
  });
});
