import { NextIntlClientProvider, type IntlError } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { ThemeProvider } from '../src/components/theme-provider';
import { AuthenticatedShell } from '../src/features/shell/components/authenticated-shell';
import { SecondFactorForm } from '../src/features/auth/components/second-factor-form';
import { DisableTwoFactor } from '../src/features/two-factor/components/disable-two-factor';
import { RecoveryCodes } from '../src/features/two-factor/components/recovery-codes';
import { TwoFactorSetup } from '../src/features/two-factor/components/two-factor-setup';
import { TwoFactorStatus } from '../src/features/two-factor/components/two-factor-status';

const CATALOGS = { es, en } as const;
const noop = () => undefined;
const CODES = Array.from({ length: 10 }, (_, index) => `ABCDE-FGH${index}J`);

/** Every new screen in every state that shows its own copy, including its error messages. */
const SCREENS: [string, ReactElement][] = [
  [
    'status (loading)',
    <TwoFactorStatus
      key="loading"
      state={{ kind: 'loading' }}
      pending={false}
      onEnable={noop}
      onDisable={noop}
      onRetry={noop}
    />,
  ],
  [
    'status (off, pending, with errors)',
    <TwoFactorStatus
      key="off"
      state={{ kind: 'ready', enabled: false, recoveryCodesRemaining: 0 }}
      pending
      notice="disabled"
      error="twoFactorAlreadyEnabled"
      onEnable={noop}
      onDisable={noop}
      onRetry={noop}
    />,
  ],
  [
    'status (on)',
    <TwoFactorStatus
      key="on"
      state={{ kind: 'ready', enabled: true, recoveryCodesRemaining: 3 }}
      pending={false}
      notice="enabled"
      error="twoFactorNotEnabled"
      onEnable={noop}
      onDisable={noop}
      onRetry={noop}
    />,
  ],
  [
    'setup',
    <TwoFactorSetup
      key="setup"
      qrDataUrl="data:image/svg+xml;utf8,"
      secret="JBSWY3DPEHPK3PXP"
      pending={false}
      errors={{ fields: { code: 'totpCodeFormat' }, form: 'twoFactorSetupRequired' }}
      onSubmit={noop}
      onCancel={noop}
    />,
  ],
  [
    'recovery codes',
    <RecoveryCodes key="codes" codes={CODES} copyStatus="copied" onCopy={noop} onDone={noop} />,
  ],
  [
    'recovery codes (copy failed)',
    <RecoveryCodes key="failed" codes={CODES} copyStatus="failed" onCopy={noop} onDone={noop} />,
  ],
  [
    'disable',
    <DisableTwoFactor
      key="disable"
      pending
      errors={{ fields: { code: 'secondFactorCodeFormat' } }}
      onSubmit={noop}
      onCancel={noop}
    />,
  ],
  [
    'second factor (authenticator)',
    <SecondFactorForm
      key="totp"
      mode="totp"
      pending={false}
      errors={{ fields: { code: 'codeInvalid' }, form: 'secondFactorExpired' }}
      onSubmit={noop}
      onModeChange={noop}
    />,
  ],
  [
    'second factor (recovery code)',
    <SecondFactorForm
      key="recovery"
      mode="recovery"
      pending
      errors={{}}
      onSubmit={noop}
      onModeChange={noop}
    />,
  ],
  [
    'authenticated shell',
    <ThemeProvider key="shell">
      <AuthenticatedShell
        state={{ kind: 'ready' }}
        signingOut={false}
        signOutError={undefined}
        onRetry={noop}
        onSignOut={noop}
      >
        <p />
      </AuthenticatedShell>
    </ThemeProvider>,
  ],
];

describe('two-factor screens in every language', () => {
  describe.each(['es', 'en'] as const)('/%s', (locale) => {
    it.each(SCREENS)('%s renders with no missing keys', (_name, element) => {
      const errors: IntlError[] = [];
      const html = renderToStaticMarkup(
        <NextIntlClientProvider
          locale={locale}
          timeZone="UTC"
          messages={CATALOGS[locale]}
          onError={(error) => errors.push(error)}
        >
          {element}
        </NextIntlClientProvider>,
      );

      expect(errors.map((error) => error.message)).toEqual([]);
      expect(html.length).toBeGreaterThan(0);
    });
  });
});
