// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DesignSystemPage from '../src/app/[locale]/design-system/page';
import { ThemeProvider } from '../src/components/theme-provider';
import { CATALOGS, renderApp, type TestLocale } from './support/render-app';

const NOT_FOUND = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' };

const COLOUR_TOKENS = [
  'background',
  'surface',
  'card',
  'muted',
  'secondary',
  'accent',
  'border',
  'input',
  'ring',
  'primary',
  'success',
  'warning',
  'destructive',
  'info',
  'income',
  'expense',
  'category-red',
  'category-slate',
];

function renderPage(locale: TestLocale = 'en') {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  return renderApp(<ThemeProvider>{DesignSystemPage()}</ThemeProvider>, { locale });
}

function preview(theme: 'light' | 'dark'): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-theme-preview="${theme}"]`);
  if (!element) throw new Error(`no ${theme} preview`);
  return element;
}

beforeEach(() => {
  vi.stubEnv('API_ORIGIN', 'https://api.pesly.test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/design-system new tokens and components (AC-37)', () => {
  it.each([
    'hero-from',
    'hero-to',
    'logo-surface',
    'chart-1',
    'chart-2',
    'chart-3',
    'chart-4',
    'chart-5',
  ])('lists --%s in both themes', (token) => {
    vi.stubEnv('NODE_ENV', 'development');
    renderPage();

    for (const theme of ['light', 'dark'] as const) {
      expect(within(preview(theme)).getByText(`--${token}`)).toBeTruthy();
    }
  });

  it.each(['light', 'dark'] as const)(
    'shows the avatar, pill tabs, chip, circular action, donut chart and balance card in the %s preview',
    (theme) => {
      vi.stubEnv('NODE_ENV', 'development');
      renderPage();
      const scope = preview(theme);

      for (const slot of [
        'avatar',
        'pill-tabs',
        'chip',
        'circular-action',
        'donut-chart',
        'balance-card',
      ]) {
        expect(scope.querySelector(`[data-slot="${slot}"]`), slot).not.toBeNull();
      }
    },
  );

  it('shows a logo avatar and a fallback avatar side by side', () => {
    vi.stubEnv('NODE_ENV', 'development');
    renderPage();

    const avatars = [...preview('light').querySelectorAll('[data-slot="avatar"]')];
    expect(avatars.some((avatar) => avatar.querySelector('img') !== null)).toBe(true);
    expect(avatars.some((avatar) => avatar.querySelector('img') === null)).toBe(true);
  });

  it('draws the card, pill and circular-action shapes from their tokens', () => {
    vi.stubEnv('NODE_ENV', 'development');
    renderPage();

    const scope = preview('light');
    expect(scope.querySelector('.rounded-card')).not.toBeNull();
    expect(scope.querySelector('.rounded-pill')).not.toBeNull();
    expect(scope.querySelector('.size-circle-action')).not.toBeNull();
  });

  it('lists the new sections by name', () => {
    vi.stubEnv('NODE_ENV', 'development');
    renderPage('es');

    const { sections } = CATALOGS.es.ui.designSystem;
    expect(
      within(preview('light')).getByRole('heading', { name: sections.primitives }),
    ).toBeTruthy();
    expect(within(preview('dark')).getByRole('heading', { name: sections.balance })).toBeTruthy();
  });
});

describe('/design-system outside production (AC-10)', () => {
  it('renders the page in a light and a dark preview', () => {
    vi.stubEnv('NODE_ENV', 'development');
    renderPage();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      CATALOGS.en.ui.designSystem.title,
    );
    expect(preview('light').classList.contains('dark')).toBe(false);
    expect(preview('dark').classList.contains('dark')).toBe(true);
  });

  it.each(COLOUR_TOKENS)('lists --%s in both themes', (token) => {
    vi.stubEnv('NODE_ENV', 'development');
    renderPage();

    for (const theme of ['light', 'dark'] as const) {
      expect(within(preview(theme)).getByText(`--${token}`)).toBeTruthy();
    }
  });

  it.each(['light', 'dark'] as const)(
    'lists every component variant in the %s preview',
    (theme) => {
      vi.stubEnv('NODE_ENV', 'development');
      renderPage();
      const scope = within(preview(theme));
      const { variants } = CATALOGS.en.ui.designSystem;

      for (const variant of ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link']) {
        expect(
          scope.getAllByRole('button', { name: variants[variant as keyof typeof variants] }).length,
        ).toBeGreaterThan(0);
      }
      expect(scope.getAllByRole('alert').length).toBeGreaterThanOrEqual(6);
      expect(scope.getByRole('checkbox')).toBeTruthy();
      expect(scope.getAllByRole('combobox').length).toBeGreaterThan(0);
    },
  );

  it('shows amounts from bigint samples with a sign for income and expense (AC-02)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    renderPage();
    const amounts = Array.from(
      preview('light').querySelectorAll<HTMLElement>('[data-slot="amount"]'),
    );

    expect(
      amounts.some((el) => el.dataset.kind === 'income' && el.textContent.startsWith('+')),
    ).toBe(true);
    expect(
      amounts.some((el) => el.dataset.kind === 'expense' && el.textContent.startsWith('−')),
    ).toBe(true);
  });

  it('renders a skeleton, an empty state and an error state from the shared components', () => {
    vi.stubEnv('NODE_ENV', 'development');
    renderPage();
    const scope = preview('light');

    expect(scope.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(scope.querySelector('[data-slot="empty-state"]')).not.toBeNull();
    expect(within(scope).getByRole('button', { name: CATALOGS.en.ui.retry })).toBeTruthy();
  });

  it.each(['es', 'en'] as const)('takes its labels from the %s catalog', (locale) => {
    vi.stubEnv('NODE_ENV', 'development');
    renderPage(locale);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      CATALOGS[locale].ui.designSystem.title,
    );
    expect(screen.getByRole('switch', { name: CATALOGS[locale].theme.darkMode })).toBeTruthy();
  });

  it('uses no float conversion for money', () => {
    for (const file of ['page.tsx', 'design-system-showcase.tsx']) {
      const source = readFileSync(
        resolve(__dirname, '../src/app/[locale]/design-system', file),
        'utf8',
      );
      expect(source, file).not.toMatch(/Number\(|parseFloat|toFixed|toLocaleString/);
    }
  });
});

describe('/design-system in production (AC-11, R-03)', () => {
  it('answers 404', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(() => DesignSystemPage()).toThrow(expect.objectContaining(NOT_FOUND));
  });
});
