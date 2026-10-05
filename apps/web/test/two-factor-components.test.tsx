// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SecondFactorForm } from '../src/features/auth/components/second-factor-form';
import { DisableTwoFactor } from '../src/features/two-factor/components/disable-two-factor';
import {
  RecoveryCodes,
  recoveryCodesFile,
} from '../src/features/two-factor/components/recovery-codes';
import { TwoFactorSetup } from '../src/features/two-factor/components/two-factor-setup';
import { TwoFactorStatus } from '../src/features/two-factor/components/two-factor-status';
import { CATALOGS, renderApp } from './support/render-app';

const { es, en } = CATALOGS;

const CODES = Array.from({ length: 10 }, (_, index) => `ABCDE-FGH${index}J`);
const QR = 'data:image/svg+xml;utf8,%3Csvg%3E%3C%2Fsvg%3E';
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

function isDisabled(name: string): boolean {
  return screen.getByRole('button', { name }).hasAttribute('disabled');
}

function statusHandlers() {
  return { onEnable: vi.fn(), onDisable: vi.fn(), onRetry: vi.fn() };
}

describe('TwoFactorStatus', () => {
  it('announces the status check while it loads', () => {
    renderApp(
      <TwoFactorStatus state={{ kind: 'loading' }} pending={false} {...statusHandlers()} />,
    );

    expect(screen.getByRole('heading', { name: es.security.twoFactor.title })).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe(es.app.loading);
    expect(screen.queryByRole('button', { name: es.security.twoFactor.enable })).toBeNull();
  });

  it('shows why the status could not be read and retries on demand', async () => {
    const handlers = statusHandlers();
    renderApp(
      <TwoFactorStatus
        state={{ kind: 'failed', error: 'network' }}
        pending={false}
        {...handlers}
      />,
    );

    expect(screen.getByText(es.errors.network)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: es.app.retry }));
    expect(handlers.onRetry).toHaveBeenCalledOnce();
  });

  it('offers to enable 2FA when it is off', async () => {
    const handlers = statusHandlers();
    renderApp(
      <TwoFactorStatus
        state={{ kind: 'ready', enabled: false, recoveryCodesRemaining: 0 }}
        pending={false}
        {...handlers}
      />,
    );

    expect(screen.getByText(es.security.twoFactor.off)).toBeDefined();
    expect(screen.queryByRole('button', { name: es.security.twoFactor.disable })).toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: es.security.twoFactor.enable }));
    expect(handlers.onEnable).toHaveBeenCalledOnce();
  });

  it('shows the remaining recovery codes and offers to disable 2FA when it is on', async () => {
    const handlers = statusHandlers();
    renderApp(
      <TwoFactorStatus
        state={{ kind: 'ready', enabled: true, recoveryCodesRemaining: 9 }}
        pending={false}
        notice="enabled"
        {...handlers}
      />,
      { locale: 'en' },
    );

    expect(screen.getByText(en.security.twoFactor.on)).toBeDefined();
    expect(screen.getByText('9 recovery codes left.')).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe(en.security.enabledNotice);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: en.security.twoFactor.disable }));
    expect(handlers.onDisable).toHaveBeenCalledOnce();
  });

  it('says when a single recovery code is left, and shows a form error', () => {
    renderApp(
      <TwoFactorStatus
        state={{ kind: 'ready', enabled: true, recoveryCodesRemaining: 1 }}
        pending={false}
        notice="disabled"
        error="retryLater"
        {...statusHandlers()}
      />,
      { locale: 'en' },
    );

    expect(screen.getByText('1 recovery code left.')).toBeDefined();
    expect(screen.getByText(en.errors.retryLater)).toBeDefined();
    expect(screen.getByText(en.security.disabledNotice)).toBeDefined();
  });

  it('shows the status as a list row with a success badge when on, with the notice as success', () => {
    renderApp(
      <TwoFactorStatus
        state={{ kind: 'ready', enabled: true, recoveryCodesRemaining: 9 }}
        pending={false}
        notice="enabled"
        {...statusHandlers()}
      />,
    );

    const row = screen.getByText(es.security.twoFactor.on).closest('[data-slot="list-row"]');
    expect(row).not.toBeNull();
    const badge = row?.querySelector('[data-slot="badge"]');
    expect(badge?.textContent).toBe(es.security.twoFactor.on);
    expect(badge?.className).toContain('text-success');
    expect(row?.textContent).toContain('9');
    expect(screen.getByRole('status').className).toContain('border-success/40');
  });

  it('shows the status as a neutral badge when off', () => {
    renderApp(
      <TwoFactorStatus
        state={{ kind: 'ready', enabled: false, recoveryCodesRemaining: 0 }}
        pending={false}
        {...statusHandlers()}
      />,
    );

    const badge = screen.getByText(es.security.twoFactor.off).closest('[data-slot="badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.className).not.toContain('text-success');
  });

  it('is disabled and says so while the setup starts', () => {
    renderApp(
      <TwoFactorStatus
        state={{ kind: 'ready', enabled: false, recoveryCodesRemaining: 0 }}
        pending
        {...statusHandlers()}
      />,
    );

    expect(isDisabled(es.security.twoFactor.starting)).toBe(true);
  });
});

describe('TwoFactorSetup', () => {
  it('shows the QR code and the secret, and submits the typed code', async () => {
    const onSubmit = vi.fn();
    renderApp(
      <TwoFactorSetup
        qrDataUrl={QR}
        secret={SECRET}
        pending={false}
        errors={{}}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: es.security.setup.title })).toBeDefined();
    expect(screen.getByRole('img', { name: es.security.setup.qrAlt }).getAttribute('src')).toBe(QR);
    expect(screen.getByText(SECRET)).toBeDefined();
    const input = screen.getByLabelText(es.security.setup.code);
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    expect(input.getAttribute('inputmode')).toBe('numeric');

    const user = userEvent.setup();
    await user.type(input, '123456');
    await user.click(screen.getByRole('button', { name: es.security.setup.submit }));
    expect(onSubmit).toHaveBeenCalledWith('123456');
  });

  it('frames the QR code in its own bordered tile and the key as a muted block', () => {
    renderApp(
      <TwoFactorSetup
        qrDataUrl={QR}
        secret={SECRET}
        pending={false}
        errors={{}}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const qr = screen.getByRole('img', { name: es.security.setup.qrAlt });
    expect(qr.parentElement?.getAttribute('data-slot')).toBe('qr-tile');
    expect(screen.getByText(SECRET).className).toContain('bg-muted');
  });

  it('shows the code error on the field, and cancels on demand', async () => {
    const onCancel = vi.fn();
    renderApp(
      <TwoFactorSetup
        qrDataUrl={QR}
        secret={SECRET}
        pending
        errors={{ fields: { code: 'codeInvalid' }, form: 'retryLater' }}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText(es.errors.codeInvalid)).toBeDefined();
    expect(screen.getByText(es.errors.retryLater)).toBeDefined();
    expect(screen.getByLabelText(es.security.setup.code).getAttribute('aria-invalid')).toBe('true');
    expect(isDisabled(es.security.setup.pending)).toBe(true);
    await userEvent.setup().click(screen.getByRole('button', { name: es.security.setup.cancel }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('RecoveryCodes soft shapes (AC-34)', () => {
  it('shows the codes in a rounded tray without a border and rounded chips', () => {
    renderApp(<RecoveryCodes codes={CODES} copyStatus="idle" onCopy={vi.fn()} onDone={vi.fn()} />);

    const tray = document.querySelector('ol.grid-cols-2');
    expect(tray?.className).toMatch(/rounded-xl/);
    expect(tray?.className).not.toMatch(/(^|\s)border(\s|$)/);
    expect(screen.getAllByRole('listitem')[0]?.className).toMatch(/rounded-lg/);
  });
});

describe('RecoveryCodes', () => {
  it('lists the 10 codes, copies them and confirms only after "I saved them"', async () => {
    const onCopy = vi.fn();
    const onDone = vi.fn();
    renderApp(<RecoveryCodes codes={CODES} copyStatus="idle" onCopy={onCopy} onDone={onDone} />);

    expect(screen.getByRole('heading', { name: es.security.recoveryCodes.title })).toBeDefined();
    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual(CODES);
    expect(screen.queryByRole('status')).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: es.security.recoveryCodes.copy }));
    expect(onCopy).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: es.security.recoveryCodes.done }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('downloads the codes as a text file named in the screen language', () => {
    renderApp(<RecoveryCodes codes={CODES} copyStatus="idle" onCopy={vi.fn()} onDone={vi.fn()} />, {
      locale: 'en',
    });

    const link = screen.getByRole('link', { name: en.security.recoveryCodes.download });
    expect(link.getAttribute('download')).toBe(en.security.recoveryCodes.fileName);
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith('data:text/plain;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(href.slice('data:text/plain;charset=utf-8,'.length))).toBe(
      recoveryCodesFile(en.security.recoveryCodes.fileHeader, CODES),
    );
  });

  it('renders the codes in a monospace grid and confirms a copy with the success variant', () => {
    renderApp(
      <RecoveryCodes codes={CODES} copyStatus="copied" onCopy={vi.fn()} onDone={vi.fn()} />,
    );

    const list = screen.getByRole('list');
    // Preflight removes the bullets, and Safari then drops the list semantics unless explicit.
    expect(list.getAttribute('role')).toBe('list');
    expect(list.className).toContain('grid');
    expect(list.className).toContain('font-mono');
    expect(list.className).toContain('grid-cols-2');
    expect(screen.getByRole('status').className).toContain('border-success/40');
  });

  it('puts one code per line after the header in the file', () => {
    expect(recoveryCodesFile('Header', ['A', 'B'])).toBe('Header\n\nA\nB\n');
  });

  it.each([
    ['copied', es.security.recoveryCodes.copied],
    ['failed', es.security.recoveryCodes.copyFailed],
  ] as const)('announces a %s copy', (copyStatus, message) => {
    renderApp(
      <RecoveryCodes codes={CODES} copyStatus={copyStatus} onCopy={vi.fn()} onDone={vi.fn()} />,
    );

    expect(screen.getByText(message)).toBeDefined();
  });
});

describe('DisableTwoFactor', () => {
  it('submits a TOTP or recovery code, and cancels on demand', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    renderApp(
      <DisableTwoFactor pending={false} errors={{}} onSubmit={onSubmit} onCancel={onCancel} />,
    );

    expect(screen.getByRole('heading', { name: es.security.disable.title })).toBeDefined();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(es.security.disable.code), 'abcde-fghij');
    await user.click(screen.getByRole('button', { name: es.security.disable.submit }));
    expect(onSubmit).toHaveBeenCalledWith('abcde-fghij');
    await user.click(screen.getByRole('button', { name: es.security.disable.cancel }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows the code error and is disabled while pending', () => {
    renderApp(
      <DisableTwoFactor
        pending
        errors={{ fields: { code: 'codeInvalid' } }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
      { locale: 'en' },
    );

    expect(screen.getByText(en.errors.codeInvalid)).toBeDefined();
    expect(isDisabled(en.security.disable.pending)).toBe(true);
  });
});

describe('SecondFactorForm', () => {
  it('asks for the authenticator code and switches to a recovery code', async () => {
    const onSubmit = vi.fn();
    const onModeChange = vi.fn();
    renderApp(
      <SecondFactorForm
        mode="totp"
        pending={false}
        errors={{}}
        onSubmit={onSubmit}
        onModeChange={onModeChange}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: es.auth.secondFactor.title }),
    ).toBeDefined();
    const input = screen.getByLabelText(es.auth.secondFactor.code);
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    const user = userEvent.setup();
    await user.type(input, '654321');
    await user.click(screen.getByRole('button', { name: es.auth.secondFactor.submit }));
    expect(onSubmit).toHaveBeenCalledWith('654321');

    await user.click(screen.getByRole('button', { name: es.auth.secondFactor.useRecoveryCode }));
    expect(onModeChange).toHaveBeenCalledWith('recovery');
    expect(
      screen.getByRole('link', { name: es.auth.secondFactor.backToSignIn }).getAttribute('href'),
    ).toBe('/es/sign-in');
  });

  it('asks for a recovery code and switches back to the authenticator', async () => {
    const onModeChange = vi.fn();
    renderApp(
      <SecondFactorForm
        mode="recovery"
        pending
        errors={{ fields: { code: 'codeInvalid' } }}
        onSubmit={vi.fn()}
        onModeChange={onModeChange}
      />,
      { locale: 'en' },
    );

    const input = screen.getByLabelText(en.auth.secondFactor.recoveryCode);
    expect(input.getAttribute('inputmode')).toBe('text');
    expect(screen.getByText(en.errors.codeInvalid)).toBeDefined();
    expect(isDisabled(en.auth.secondFactor.pending)).toBe(true);
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: en.auth.secondFactor.useAuthenticator }));
    expect(onModeChange).toHaveBeenCalledWith('totp');
  });
});
