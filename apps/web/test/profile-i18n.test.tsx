import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NextIntlClientProvider, type IntlError } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { ThemeProvider } from '../src/components/theme-provider';
import { AuthenticatedShell } from '../src/features/shell/components/authenticated-shell';
import { PreferencesForm } from '../src/features/profile/components/preferences-form';
import { ProfileForm } from '../src/features/profile/components/profile-form';

const CATALOGS = { es, en } as const;
const noop = () => undefined;
const PREFERENCES = {
  defaultRateType: 'blue',
  displayCurrency: 'ARS',
  timeZone: 'Europe/Madrid',
  language: 'en',
} as const;

const SCREENS: [string, ReactElement][] = [
  [
    'profile form',
    <ProfileForm
      key="profile"
      displayName="Ana"
      email="ana@example.com"
      twoFactorEnabled
      pending={false}
      saved
      errors={{ form: 'validationFailed', fields: { displayName: 'displayNameRequired' } }}
      onSubmit={noop}
    />,
  ],
  [
    'profile form (pending, name too long, 2FA off)',
    <ProfileForm
      key="profile-pending"
      displayName={null}
      email="ana@example.com"
      twoFactorEnabled={false}
      pending
      saved={false}
      errors={{ fields: { displayName: 'displayNameTooLong' } }}
      onSubmit={noop}
    />,
  ],
  [
    'preferences form',
    <PreferencesForm
      key="preferences"
      preferences={PREFERENCES}
      timeZones={['Europe/Madrid']}
      pending={false}
      saved
      errors={{ form: 'network', fields: { timeZone: 'timeZoneInvalid' } }}
      onSubmit={noop}
    />,
  ],
  [
    'preferences form (pending)',
    <PreferencesForm
      key="preferences-pending"
      preferences={PREFERENCES}
      timeZones={['Europe/Madrid']}
      pending
      saved={false}
      errors={{}}
      onSubmit={noop}
    />,
  ],
  [
    'authenticated shell',
    <ThemeProvider key="shell">
      <AuthenticatedShell
        state={{ kind: 'ready' }}
        // The home has no back button, so the static render needs no router.
        currentPath="/"
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

describe('profile screens in every language (FR-07)', () => {
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

  it('renders the English copy and none of the Spanish copy in en', () => {
    const [, element] = SCREENS[0] as [string, ReactElement];
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={en}>
        {element}
      </NextIntlClientProvider>,
    );

    expect(html).toContain(en.profile.account.displayName);
    expect(html).not.toContain(es.profile.account.displayName);
  });
});

describe('profile catalogs (FR-07)', () => {
  function keys(value: object, prefix = ''): string[] {
    return Object.entries(value).flatMap(([key, child]) =>
      typeof child === 'string' ? [`${prefix}${key}`] : keys(child as object, `${prefix}${key}.`),
    );
  }

  it('have the same keys in the profile namespace and the nav link', () => {
    expect(keys(en.profile).length).toBeGreaterThan(10);
    expect(keys(en.profile).sort()).toEqual(keys(es.profile).sort());
    expect(en.app.nav.profile).toBeTruthy();
    expect(es.app.nav.profile).toBeTruthy();
  });

  it('have a label for every rate type, currency and language', () => {
    expect(Object.keys(en.profile.rateTypes)).toEqual(Object.keys(es.profile.rateTypes));
    expect(Object.keys(en.profile.rateTypes)).toHaveLength(7);
    expect(Object.keys(en.profile.currencies)).toEqual(['ARS', 'USD']);
    expect(Object.keys(en.profile.languages)).toEqual(['es', 'en']);
  });
});

describe('no string is hard-coded in the profile components (FR-07)', () => {
  const SRC = fileURLToPath(new URL('../src/', import.meta.url));
  const FILES = [
    ...collect(`${SRC}features/profile`),
    `${SRC}components/ui/select.tsx`,
    `${SRC}app/[locale]/(app)/settings/profile/page.tsx`,
  ];

  function collect(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = `${directory}/${name}`;
      return statSync(path).isDirectory() ? collect(path) : [path];
    });
  }

  it('finds the new files', () => {
    expect(FILES.filter((file) => file.endsWith('.tsx')).length).toBeGreaterThanOrEqual(4);
  });

  it.each(FILES.filter((file) => file.endsWith('.tsx')))(
    '%s has no JSX text and no literal text attribute',
    (file) => {
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const jsxText = [...source.matchAll(/>\s*([^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]*)\s*</g)].map(
        (match) => match[1],
      );
      const textAttributes = [
        ...source.matchAll(
          /\b(?:aria-label|title|placeholder|alt|label)="[^"]*[A-Za-z]{2,}[^"]*"/g,
        ),
      ].map((match) => match[0]);

      expect([...jsxText, ...textAttributes]).toEqual([]);
    },
  );
});
