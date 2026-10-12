import { expect, test, type Locator, type Page } from '@playwright/test';
import { signIn } from './support/accounts';
import { probeContrast } from './support/contrast';
import { resetAttemptLimits, withoutStoredRates } from './support/database';
import {
  FIRST_STEPS_DASHBOARD,
  NO_RATE_DASHBOARD,
  readyDashboard,
} from './support/dashboard-fixtures';
import {
  es,
  expectReady,
  expectWithinWidth,
  horizontalOverflow,
  installOfflineSwitch,
  leaveAndReturnHome,
  openWithTheme,
  overflowingNavigations,
  registerNewUser,
  seedDashboardUser,
  seedFailedMovement,
  setReportedOffline,
  stubDashboard,
  undersizedTargets,
  unreachableByKeyboard,
  watchFigureRequests,
  type DashboardStub,
  type FigureRequests,
} from './support/dashboard';
import { createAccount } from './support/offline-visit';

// Spec DISC-001-09c, Block 8. `GET /dashboard` (slice 09b) is not on this branch yet, so it is
// served by `stubDashboard`; accounts, movements and `GET /reports/net-worth` are real.
// TODO(09b): replace `stubDashboard` with real seeds once 09b merges (see support/dashboard.ts).

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

const PHONE = { width: 360, height: 780 };
const THEMES = ['light', 'dark'] as const;
const t = es.dashboard;

/** `next dev` runs every effect twice (React StrictMode); the request counts need the real build. */
const PRODUCTION_BUILD = Boolean(process.env.CI) || process.env.E2E_PRODUCTION_BUILD === '1';

let email = '';
let newcomer = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  await resetAttemptLimits();
  const page = await browser.newPage({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  email = await seedDashboardUser(page, 'dashboard');
  newcomer = await registerNewUser(page, 'dashboard-new');
  await page.close();
});

test.beforeEach(async () => {
  await resetAttemptLimits();
});

interface Session {
  stub: DashboardStub;
  figures: FigureRequests;
}

/**
 * The stub and the counter go in before the sign-in, because signing in lands on the home, which
 * asks for the dashboard at once.
 */
async function signedIn(
  page: Page,
  options: {
    who?: string;
    theme?: 'light' | 'dark';
    overrides?: Parameters<typeof stubDashboard>[1];
  } = {},
): Promise<Session> {
  if (options.theme !== undefined) await openWithTheme(page, options.theme);
  const stub = await stubDashboard(page, options.overrides);
  const figures = await watchFigureRequests(page);
  await signIn(page, options.who ?? email);
  await expect(page).toHaveURL(/\/es$/);
  return { stub, figures };
}

function kpi(page: Page, label: string): Locator {
  return page.getByRole('group', { name: label, exact: true });
}

function themeGroup(page: Page): Locator {
  return page.getByRole('radiogroup', { name: es.theme.label });
}

for (const width of [360, 1280]) {
  for (const theme of THEMES) {
    test(`the home at ${width} px in the ${theme} theme shows its cards with no horizontal scroll (NFR-02, AC-06)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await signedIn(page, { theme });
      await page.goto('/es');
      await expectReady(page);

      await expect(page.locator('html')).toHaveClass(
        theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/,
      );
      await expectWithinWidth(page.getByRole('region', { name: t.netWorth.label }), width);
      for (const label of [t.month.expenses, t.month.income, t.month.net]) {
        await expectWithinWidth(kpi(page, label), width);
      }
      await expectWithinWidth(page.getByRole('heading', { name: t.attention.title }), width);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
}

test('the home sends exactly one request to each of the two figure paths and none to any other (FR-18, AC-37, NFR-05)', async ({
  page,
}) => {
  test.skip(!PRODUCTION_BUILD, 'next dev runs effects twice; run with E2E_PRODUCTION_BUILD=1');
  const { figures } = await signedIn(page);
  figures.reset();

  await page.goto('/es');
  await expectReady(page);
  await page.waitForLoadState('networkidle');

  expect(figures.count('/dashboard')).toBe(1);
  expect(figures.count('/reports/net-worth')).toBe(1);
  expect(figures.others()).toEqual([]);
});

test.describe('navigation by width (NFR-02, AC-38, AC-39, AC-40)', () => {
  for (const theme of THEMES) {
    test(`widths 360, 768, 1023, 1024 and 1920 in the ${theme} theme have no horizontal scroll and the right navigation`, async ({
      page,
    }) => {
      await signedIn(page, { theme });

      for (const width of [360, 768, 900, 1023, 1024, 1920]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/es');
        await expectReady(page);

        const wide = width >= 1024;
        const sideMenu = page.locator('[data-slot="top-nav"]');
        const bottomBar = page.locator('[data-slot="bottom-nav"]');
        await (wide ? expect(sideMenu) : expect(bottomBar)).toBeVisible();
        await (wide ? expect(bottomBar) : expect(sideMenu)).toBeHidden();
        expect(await horizontalOverflow(page), `${width} px`).toBeLessThanOrEqual(0);
        expect(await overflowingNavigations(page), `${width} px`).toEqual([]);
      }
    });
  }
});

test.describe('the theme control (AC-41, AC-43, AC-44, AC-46)', () => {
  test.use({ viewport: PHONE });

  test('offers light, dark and system, and marks the chosen one with a check and its state', async ({
    page,
  }) => {
    await signedIn(page);
    await page.goto('/es/more');

    const group = themeGroup(page);
    await expect(group.getByRole('radio')).toHaveCount(3);
    for (const label of [es.theme.light, es.theme.dark, es.theme.system]) {
      await expect(group.getByRole('radio', { name: label })).toHaveCount(1);
      await expect(group.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(group.getByRole('radio', { name: es.theme.system })).toBeChecked();

    await group.getByText(es.theme.dark, { exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await expect(group.getByRole('radio', { name: es.theme.dark })).toBeChecked();
    await expect(group.locator('[data-slot="theme-check"]')).toHaveCount(1);
    await expect(
      group.locator('label', { hasText: es.theme.dark }).locator('[data-slot="theme-check"]'),
    ).toHaveCount(1);
    await expect(page.getByText(/modo oscuro/i)).toHaveCount(0);
  });

  test('dark survives signing out and signing in again (AC-44)', async ({ page }) => {
    await signedIn(page);
    await page.goto('/es/more');
    await themeGroup(page).getByText(es.theme.dark, { exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);

    await page.getByRole('button', { name: es.auth.signOut.label }).click();
    await expect(page).toHaveURL(/\/es\/sign-in$/);
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);

    await signIn(page, email);
    await expect(page).toHaveURL(/\/es$/);
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  });

  test('the dark class is present before the first paint, with the scripts of the app blocked (AC-46)', async ({
    page,
  }) => {
    await signedIn(page);
    await page.goto('/es/more');
    await themeGroup(page).getByText(es.theme.dark, { exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);

    let blocked = 0;
    await page.route(
      (url) => url.pathname.startsWith('/_next/static/') && url.pathname.endsWith('.js'),
      async (route) => {
        blocked += 1;
        await route.abort();
      },
    );
    await page.goto('/es/sign-in', { waitUntil: 'domcontentloaded' });

    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(
      true,
    );
    expect(blocked, 'the scripts of the app were requested and blocked').toBeGreaterThan(0);
  });

  test('"System" follows the operating system without a reload (AC-43)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await signedIn(page);
    await page.goto('/es/more');
    const group = themeGroup(page);
    await group.getByText(es.theme.dark, { exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);

    await group.getByText(es.theme.system, { exact: true }).click();
    await expect(group.getByRole('radio', { name: es.theme.system })).toBeChecked();
    // "System" is stored by removing the key.
    expect(await page.evaluate(() => localStorage.getItem('pesly-theme'))).toBeNull();
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  });
});

test.describe('states (AC-03, AC-05, AC-29, AC-30, AC-34, AC-35)', () => {
  test.use({ viewport: PHONE });

  test('a new user sees the first-steps guide and no chart; after creating an account the movement step remains (AC-29, AC-30)', async ({
    page,
  }) => {
    const { stub } = await signedIn(page, { who: newcomer, overrides: FIRST_STEPS_DASHBOARD });

    await expect(page.getByRole('heading', { name: t.firstSteps.title })).toBeVisible();
    await expect(page.getByRole('link', { name: t.firstSteps.createAccount })).toBeVisible();
    await expect(page.getByRole('region', { name: t.netWorth.label })).toHaveCount(0);
    await expect(page.getByRole('slider', { name: t.chart.name })).toHaveCount(0);

    await createAccount(page, 'Caja nueva');
    stub.show({
      ...FIRST_STEPS_DASHBOARD,
      firstSteps: { hasAccount: true, hasMovement: false, show: true },
    });
    await page.goto('/es');

    await expect(page.getByRole('heading', { name: t.firstSteps.title })).toBeVisible();
    await expect(page.getByText(t.firstSteps.done, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: t.firstSteps.recordMovement })).toBeVisible();
    await expect(page.getByRole('link', { name: t.firstSteps.createAccount })).toHaveCount(0);
    await expect(page.getByRole('slider', { name: t.chart.name })).toHaveCount(0);
  });

  test('with the stored rates removed the net worth card shows both parts and the unavailable message (AC-05)', async ({
    page,
  }) => {
    await withoutStoredRates(async () => {
      await signedIn(page, { overrides: NO_RATE_DASHBOARD });
      await page.goto('/es');
      await expectReady(page);

      const card = page.getByRole('region', { name: t.netWorth.label });
      await expect(card.getByText(t.netWorth.conversionUnavailable)).toBeVisible();
      await expect(card.getByText(t.netWorth.ars, { exact: true })).toBeVisible();
      await expect(card.getByText(t.netWorth.usd, { exact: true })).toBeVisible();
    });
  });

  test('a failed series shows the chart retry and the other cards stay (AC-34)', async ({
    page,
  }) => {
    const { figures } = await signedIn(page);
    figures.failSeries(true);
    await page.goto('/es');
    await expectReady(page);

    const card = page.getByRole('region', { name: t.netWorth.label });
    await expect(card.getByText(t.chart.failed)).toBeVisible();
    await expect(card.getByRole('button', { name: t.chart.retry })).toBeVisible();
    await expect(kpi(page, t.month.expenses)).toBeVisible();
    await expect(page.getByRole('heading', { name: t.attention.title })).toBeVisible();

    figures.failSeries(false);
    await card.getByRole('button', { name: t.chart.retry }).click();
    await expect(card.getByText(t.chart.failed)).toHaveCount(0);
    await expect(kpi(page, t.month.expenses)).toBeVisible();
  });

  test('a failed dashboard shows the error state, and its retry works (AC-03)', async ({
    page,
  }) => {
    const { stub } = await signedIn(page);
    stub.respondWith({ kind: 'status', status: 500 });
    await page.goto('/es');

    await expect(page.getByText(t.states.error)).toBeVisible();
    await expect(page.getByRole('region', { name: t.netWorth.label })).toHaveCount(0);

    stub.show();
    await page.getByRole('button', { name: t.states.retry, exact: true }).click();
    await expectReady(page);
    await expect(page.getByText(t.states.error)).toHaveCount(0);
  });

  test('offline after a load shows the figures with the out-of-date notice (AC-35)', async ({
    page,
  }) => {
    await installOfflineSwitch(page);
    const { stub } = await signedIn(page);
    await expectReady(page);

    await setReportedOffline(page, true);
    stub.respondWith({ kind: 'disconnected' });
    await leaveAndReturnHome(page);

    await expect(page.getByText(t.states.outOfDate)).toBeVisible();
    await expectReady(page);
    await expect(kpi(page, t.month.expenses)).toBeVisible();
  });

  test('a failed change waiting on the device is listed under "do these first" (FR-12)', async ({
    page,
  }) => {
    await signedIn(page);
    await expectReady(page);
    await seedFailedMovement(page, email);
    await page.reload();
    await expectReady(page);

    const link = page.getByRole('link', { name: /1 movimiento no se sincroniz/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/es/movements');
  });

  test('the home offers the quick actions and no balance summary (AC-49)', async ({ page }) => {
    await signedIn(page);
    await expectReady(page);

    const actions = page.getByRole('list', { name: es.home.quickActions.label });
    await expect(actions.getByRole('link')).toHaveCount(4);
    await expect(page.getByText(es.accounts.headline.available, { exact: true })).toHaveCount(0);
  });
});

for (const width of [360, 1280]) {
  test(`every interactive element of the home and the navigation at ${width} px is at least 44 by 44 and reachable by keyboard (NFR-08)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await signedIn(page);
    await expectReady(page);
    await seedFailedMovement(page, email);
    await page.goto('/es');
    await expectReady(page);

    expect(await undersizedTargets(page)).toEqual([]);
    expect(await unreachableByKeyboard(page)).toEqual([]);
  });
}

test.describe('the contrast probe (NFR-03)', () => {
  test.use({ viewport: PHONE });

  for (const theme of THEMES) {
    test(`passes on the ready, first-steps, no-rate, chart-error, error and offline states in the ${theme} theme`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await installOfflineSwitch(page);
      const { stub, figures } = await signedIn(page, { theme });
      const name = (state: string) => `${state} (${theme})`;

      stub.show();
      await page.goto('/es');
      await expectReady(page);
      await expect(page.getByRole('heading', { name: t.attention.title })).toBeVisible();
      await probeContrast(page, name('ready'));

      stub.show(FIRST_STEPS_DASHBOARD);
      await page.goto('/es');
      await expect(page.getByRole('heading', { name: t.firstSteps.title })).toBeVisible();
      await probeContrast(page, name('first-steps'));

      stub.show(NO_RATE_DASHBOARD);
      await page.goto('/es');
      await expect(page.getByText(t.netWorth.conversionUnavailable)).toBeVisible();
      await probeContrast(page, name('no-rate'));

      stub.show();
      figures.failSeries(true);
      await page.goto('/es');
      await expect(page.getByText(t.chart.failed)).toBeVisible();
      await probeContrast(page, name('chart-error'));
      figures.failSeries(false);

      stub.respondWith({ kind: 'status', status: 500 });
      await page.goto('/es');
      await expect(page.getByText(t.states.error)).toBeVisible();
      await probeContrast(page, name('error'));

      stub.respondWith({ kind: 'ok', body: readyDashboard() });
      await page.goto('/es');
      await expectReady(page);
      await setReportedOffline(page, true);
      stub.respondWith({ kind: 'disconnected' });
      await leaveAndReturnHome(page);
      await expect(page.getByText(t.states.outOfDate)).toBeVisible();
      await probeContrast(page, name('offline'));
    });
  }
});
