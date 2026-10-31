import { expect, test, type Locator, type Page } from '@playwright/test';
import { signIn } from './support/accounts';
import { probeContrast } from './support/contrast';
import { resetAttemptLimits } from './support/database';
import {
  es,
  expectReady,
  horizontalOverflow,
  installOfflineSwitch,
  openWithTheme,
  setReportedOffline,
  undersizedTargets,
  unreachableByKeyboard,
} from './support/dashboard';
import {
  MARKER_TOTAL_FORMATTED,
  MARKER_TOTAL_MINOR,
  REPORT_ROUTE,
  ACCOUNT,
  SECOND_ACCOUNT,
  SEEDED_CATEGORY_NAMES,
  SEEDED_EXPENSES,
  SEEDED_SHARES,
  SEEDED_TOTAL,
  categoriesFixture,
  emptyCategoriesFixture,
  emptyIncomeExpensesFixture,
  emptyNetWorthFixture,
  findInBrowserStorage,
  gate,
  incomeExpensesFixture,
  leftoverStubs,
  markerCategoriesFixture,
  monthLabel,
  money,
  netWorthFixture,
  ok,
  removeLeftoverStubs,
  seedReportsUser,
  shiftMonth,
  signInHere,
  todayInCordoba,
  unconvertedNetWorthFixture,
  withReportStubs,
  type ReportAnswer,
  type ReportKey,
  type ReportStubs,
} from './support/reports';

// Spec DISC-001-09d, Block 8. Accounts, movements and the happy paths run against the real API;
// the cases real data cannot produce (a slow first answer, 404 for a filter, 400 on `to`, a
// conversion gap, an empty range) are served by typed fixtures from `support/reports.ts`.

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

const r = es.reports;
const PHONE = { width: 360, height: 780 };
const DESK = { width: 1280, height: 900 };
const THEMES = ['light', 'dark'] as const;
const KEYS: readonly ReportKey[] = ['categories', 'incomeExpenses', 'netWorth'];
const TITLE_OF: Record<ReportKey, string> = {
  categories: r.categories.listName,
  incomeExpenses: r.incomeExpenses.listName,
  netWorth: r.netWorth.listName,
};

/** `next dev` runs every effect twice (React StrictMode); the request counts need the real build. */
const PRODUCTION_BUILD = Boolean(process.env.CI) || process.env.E2E_PRODUCTION_BUILD === '1';

const today = todayInCordoba();
const month = today.slice(0, 7);

let email = '';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  await resetAttemptLimits();
  const page = await browser.newPage({ locale: 'es-AR', timezoneId: 'America/Cordoba' });
  email = await seedReportsUser(page, 'reports');
  await page.close();
});

test.beforeEach(async () => {
  await resetAttemptLimits();
});

test.afterEach(async () => {
  const left = leftoverStubs();
  await removeLeftoverStubs();
  expect(left, 'a test left a report stub installed').toBe(0);
});

async function signedIn(page: Page, theme?: 'light' | 'dark'): Promise<void> {
  if (theme !== undefined) await openWithTheme(page, theme);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
}

function figures(page: Page, key: ReportKey): Locator {
  return page.getByRole('list', { name: TITLE_OF[key] });
}

async function expectReport(page: Page, key: ReportKey): Promise<void> {
  await expect(figures(page, key)).toBeVisible();
}

async function visit(page: Page, key: ReportKey, query = ''): Promise<void> {
  await page.goto(`${REPORT_ROUTE[key]}${query}`);
}

/** At phone width the filters sit behind one control; this opens it when it is closed. */
async function openFilters(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /^Más filtros/ });
  if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}

function dateField(page: Page, field: 'from' | 'to'): Locator {
  return page.getByLabel(r.range[field], { exact: true });
}

/** Opens a report through its tab and waits until its address is the current one. */
async function openTab(page: Page, key: ReportKey): Promise<void> {
  await page
    .getByRole('navigation', { name: r.tabs.label })
    .getByRole('link', { name: TAB_OF[key] })
    .click();
  await expect(page).toHaveURL(new RegExp(`${REPORT_ROUTE[key]}$`));
}

/** A whole-percent share as the list prints it. */
function percentText(share: number): string {
  return share === 0
    ? r.categories.underOne
    : r.categories.percent.replace('{percent}', `${share}`);
}

// ---------------------------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------------------------

test.describe('navigation (FR-01, FR-02, FR-03)', () => {
  test('opening /reports lands on the categories screen with three tabs, and Net worth is marked current (FR-01, AC-01, AC-02)', async ({
    page,
  }) => {
    await signedIn(page);
    await page.goto('/es/reports');
    await expect(page).toHaveURL(/\/es\/reports\/categories$/);

    const tabs = page.getByRole('navigation', { name: r.tabs.label });
    await expect(tabs.getByRole('link')).toHaveText([
      r.tabs.categories,
      r.tabs.incomeExpenses,
      r.tabs.netWorth,
    ]);
    await expect(tabs.getByRole('link', { name: r.tabs.categories })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await tabs.getByRole('link', { name: r.tabs.netWorth }).click();
    await expect(page).toHaveURL(/\/es\/reports\/net-worth$/);
    await expect(tabs.getByRole('link', { name: r.tabs.netWorth })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(tabs.getByRole('link', { name: r.tabs.categories })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  for (const key of KEYS) {
    test(`a signed-out visit to ${key} goes to sign-in and comes back after signing in (FR-01, FR-23, AC-03)`, async ({
      page,
    }) => {
      await page.goto(REPORT_ROUTE[key]);
      const route = REPORT_ROUTE[key].replace('/es', '');
      await expect(page).toHaveURL(new RegExp(`/es/sign-in\\?next=${encodeURIComponent(route)}$`));

      await signInHere(page, email);
      await expect(page).toHaveURL(new RegExp(`${REPORT_ROUTE[key]}$`));
      await expectReport(page, key);
    });
  }

  test('a return address that is not a report route is ignored after signing in (FR-23, D2)', async ({
    page,
  }) => {
    await page.goto('/es/sign-in?next=%2F%2Fevil.example%2Freports');
    await signInHere(page, email);
    await expect(page).toHaveURL(/\/es$/);
  });

  test('the side menu at 1280 px lists Reports in the plan ahead block; the More page at 360 px lists it and marks More current (FR-02, AC-04, AC-05)', async ({
    page,
  }) => {
    await page.setViewportSize(DESK);
    await signedIn(page);

    const menu = page.locator('[data-slot="top-nav"]');
    const planBlock = menu
      .locator('ul')
      .filter({ has: page.getByRole('link', { name: es.app.nav.budgets, exact: true }) });
    await expect(
      planBlock.getByRole('link', { name: es.app.nav.reports, exact: true }),
    ).toBeVisible();

    await page.setViewportSize(PHONE);
    await page.goto('/es/more');
    await page.getByRole('link', { name: es.app.nav.reports, exact: true }).click();
    await expect(page).toHaveURL(/\/es\/reports\/categories$/);
    await expect(
      page
        .locator('[data-slot="bottom-nav"]')
        .getByRole('link', { name: es.app.nav.more, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('the dashboard links open the categories and the net worth reports (FR-03, AC-06, AC-07)', async ({
    page,
  }) => {
    await page.setViewportSize(DESK);
    await signedIn(page);
    await page.goto('/es');
    await expectReady(page);

    await page
      .locator('a[href$="/reports/categories"]', { hasText: es.dashboard.categories.viewReport })
      .click();
    await expect(page).toHaveURL(/\/es\/reports\/categories$/);
    await expectReport(page, 'categories');

    await page.goto('/es');
    await expectReady(page);
    await page
      .locator('a[href$="/reports/net-worth"]', { hasText: es.dashboard.netWorth.viewReport })
      .click();
    await expect(page).toHaveURL(/\/es\/reports\/net-worth$/);
    await expectReport(page, 'netWorth');
  });
});

// ---------------------------------------------------------------------------------------------
// The three screens with real seeded data
// ---------------------------------------------------------------------------------------------

test.describe('real data', () => {
  test.use({ viewport: DESK });

  test('the category report shows the real total, the shares and 6 ring segments for 8 categories (FR-04, FR-05, FR-06, AC-08, AC-11, AC-13)', async ({
    page,
  }) => {
    await signedIn(page);
    await visit(page, 'categories');
    await expectReport(page, 'categories');

    // The total heads the card and sits again in the hole of the ring.
    await expect(
      page.getByText(new RegExp(`^${SEEDED_TOTAL.replace('.', '\\.')}\\sARS$`)).first(),
    ).toBeVisible();

    const rows = figures(page, 'categories').getByRole('listitem');
    await expect(rows).toHaveCount(SEEDED_EXPENSES.length);
    for (const [index, amount] of SEEDED_EXPENSES.entries()) {
      const row = rows.nth(index);
      await expect(row).toContainText(SEEDED_CATEGORY_NAMES[index] ?? '');
      await expect(row).toContainText(percentText(SEEDED_SHARES[index] ?? 0));
      await expect(row).toContainText(new RegExp(`${amount.replace('.', '\\.')}\\sARS`));
    }

    const shownShares = SEEDED_SHARES.reduce<number>((sum, share) => sum + share, 0);
    expect(shownShares, 'the shares shown add up to 100%').toBe(100);
    // One arc per category, each named with its amount and share in the legend.
    await expect(page.locator('figure[data-slot="category-pie"] circle[data-segment]')).toHaveCount(
      SEEDED_EXPENSES.length,
    );
  });

  test('income against expenses shows 12 months and the net result signs (FR-07, AC-15, AC-16)', async ({
    page,
  }) => {
    await signedIn(page);
    await visit(page, 'incomeExpenses');
    await expectReport(page, 'incomeExpenses');

    // The chart draws the 12 months; the list keeps the months that had movements.
    await expect(figures(page, 'incomeExpenses').getByRole('listitem')).not.toHaveCount(0);
    await expect(page.locator('svg [data-bar="income"]')).toHaveCount(12);
    await expect(page.locator('svg [data-bar="expenses"]')).toHaveCount(12);

    const thisMonth = figures(page, 'incomeExpenses')
      .getByRole('listitem')
      .filter({ hasText: monthLabel(month) });
    await expect(thisMonth).toContainText(money(300_000, 'ARS'));
    await expect(thisMonth).toContainText(money(158_000, 'ARS'));
    await expect(thisMonth).toContainText(new RegExp(`\\+${money(142_000, 'ARS').source}`));

    // About 40 days ago: 100.00 of income against 200.00 of expenses.
    const earlier = todayInCordoba(new Date(Date.now() - 40 * 86_400_000)).slice(0, 7);
    const spent = figures(page, 'incomeExpenses')
      .getByRole('listitem')
      .filter({ hasText: monthLabel(earlier) });
    await expect(spent).toContainText(new RegExp(`−${money(10_000, 'ARS').source}`));
  });

  test('the net worth report lists the real months and ends today (FR-08, FR-09)', async ({
    page,
  }) => {
    await signedIn(page);
    await visit(page, 'netWorth');
    await expectReport(page, 'netWorth');
    await expect(figures(page, 'netWorth').getByRole('listitem')).not.toHaveCount(0);
    await expect(page.getByRole('slider', { name: r.netWorth.chartName })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------
// Typed fixtures for what real data cannot produce
// ---------------------------------------------------------------------------------------------

test.describe('fixtures', () => {
  test.use({ viewport: DESK });

  test('shares are whole numbers, never over 100%, a null category is the group shares and a tiny one is under 1% (FR-04, FR-05, FR-06, AC-09, AC-12, AC-14)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      const id = (digit: string) =>
        `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
      stubs.answer(
        'categories',
        ok(
          'categories',
          categoriesFixture(today, {
            total: '10000',
            categories: [
              { categoryId: id('1'), name: null, defaultKey: 'food', amount: '3334' },
              { categoryId: id('2'), name: null, defaultKey: 'transport', amount: '3333' },
              { categoryId: null, name: null, defaultKey: null, amount: '3332' },
              { categoryId: id('3'), name: 'Mascotas', defaultKey: null, amount: '1' },
            ],
          }),
        ),
      );
      await visit(page, 'categories');
      const rows = figures(page, 'categories').getByRole('listitem');
      await expect(rows).toHaveCount(4);
      await expect(rows.nth(0)).toContainText('Comida');
      await expect(rows.nth(0)).toContainText('34%');
      await expect(rows.nth(1)).toContainText('33%');
      await expect(rows.nth(2)).toContainText(r.categories.groupShares);
      await expect(rows.nth(2)).toContainText('33%');
      await expect(rows.nth(3)).toContainText('Mascotas');
      await expect(rows.nth(3)).toContainText(r.categories.underOne);
      await expect(rows.nth(3)).toContainText(money(1, 'ARS'));
    });
  });

  test('the fixture of AC-08 shows 60% and 40% in Spanish with the profile currency note (FR-04, FR-16, AC-08, AC-35, AC-49)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      stubs.answer('categories', ok('categories', categoriesFixture(today)));
      await visit(page, 'categories');
      const rows = figures(page, 'categories').getByRole('listitem');
      await expect(rows.nth(0)).toContainText('Comida');
      await expect(rows.nth(0)).toContainText('60%');
      await expect(rows.nth(0)).toContainText(money(12_000_000, 'ARS'));
      await expect(rows.nth(1)).toContainText('Transporte');
      await expect(rows.nth(1)).toContainText('40%');
      await expect(page.getByText(/· en ARS$/)).toBeVisible();
      await expect(page.getByRole('link', { name: r.meta.changeCurrency })).toBeVisible();
    });
  });

  test('a USD answer is formatted as USD and never mixed with ARS (FR-16, AC-36)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      stubs.answer(
        'categories',
        ok('categories', categoriesFixture(today, { currency: 'USD', total: '20000000' })),
      );
      await visit(page, 'categories');
      await expect(page.getByText(/· en USD$/)).toBeVisible();
      await expect(figures(page, 'categories').getByRole('listitem').nth(0)).toContainText(
        money(12_000_000, 'USD'),
      );
      await expect(page.getByText(/\sARS\b/)).toHaveCount(0);
    });
  });

  test('unconverted counts and the filtered notice appear only when they apply (FR-17, FR-18, AC-37, AC-38, AC-39)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      stubs.answer(
        'categories',
        ok(
          'categories',
          categoriesFixture(today, { unconvertedShareCount: 2, unconvertedInstallmentCount: 1 }),
        ),
      );
      await visit(page, 'categories');
      await expect(
        page.getByText('Quedan afuera por no tener tipo de cambio: 2 partes de grupo y 1 cuota.', {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByText(r.notices.filtered, { exact: true })).toHaveCount(0);

      stubs.answer('categories', ok('categories', categoriesFixture(today)));
      await visit(page, 'categories', '?tag=vacations2026');
      await expect(page.getByText(r.notices.filtered, { exact: true })).toBeVisible();
      await expect(page.getByText(/Quedan afuera/)).toHaveCount(0);

      await visit(page, 'categories');
      await expect(figures(page, 'categories')).toBeVisible();
      await expect(page.getByText(r.notices.filtered, { exact: true })).toHaveCount(0);
    });
  });

  test('a net worth with a month without a rate leaves a gap, says why, and the arrows move the selection (FR-08, FR-09, FR-10, FR-11, AC-19, AC-20, AC-21, AC-23)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      stubs.answer('netWorth', ok('netWorth', netWorthFixture(today)));
      await visit(page, 'netWorth');
      await expectReport(page, 'netWorth');

      // Six month ends, one without a total: two runs of the line, the reason said once.
      await expect(figures(page, 'netWorth').getByRole('listitem')).toHaveCount(6);
      await expect(page.locator('svg path[data-chart-line]')).toHaveCount(2);
      await expect(page.getByText(r.netWorth.noRateOnce)).toHaveCount(1);

      const slider = page.getByRole('slider', { name: r.netWorth.chartName });
      await slider.focus();
      await expect(slider).toHaveAttribute('aria-valuenow', '4');
      const detail = page.getByTestId('net-worth-detail');
      await expect(detail).toContainText(money(150_000_000, 'ARS'));
      await expect(detail).toContainText(money(55_000, 'USD'));
      await expect(detail).toContainText(money(255_000_000, 'ARS'));
      await expect(detail).toContainText(r.netWorth.investmentsIncomplete);
      const before = await slider.getAttribute('aria-valuetext');

      await slider.press('ArrowLeft');
      await expect(slider).toHaveAttribute('aria-valuenow', '3');
      const after = await slider.getAttribute('aria-valuetext');
      expect(after).not.toBe(before);
      await expect(page.getByTestId('net-worth-announce')).toHaveText(after ?? '');
      await expect(page.getByTestId('chart-tooltip')).toBeVisible();

      await slider.press('ArrowRight');
      await expect(slider).toHaveAttribute('aria-valuenow', '4');
    });
  });

  test('a net worth where no month converts shows the components and the notice instead of a chart (FR-10, AC-22)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      stubs.answer('netWorth', ok('netWorth', unconvertedNetWorthFixture(today)));
      await visit(page, 'netWorth');
      await expectReport(page, 'netWorth');
      await expect(page.getByText(r.netWorth.conversionUnavailable)).toBeVisible();
      await expect(page.getByRole('slider')).toHaveCount(0);
      await expect(figures(page, 'netWorth').getByRole('listitem')).toHaveCount(6);
    });
  });

  test('every chart has a named figure with a summary, a hidden drawing and a list with the same figures (FR-21, AC-45, AC-46)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      stubs.answer('categories', ok('categories', categoriesFixture(today)));
      stubs.answer('incomeExpenses', ok('incomeExpenses', incomeExpensesFixture(today)));
      stubs.answer('netWorth', ok('netWorth', netWorthFixture(today)));
      // The ring of categories is a named image whose legend is the list itself.
      await visit(page, 'categories');
      await expectReport(page, 'categories');
      await expect(page.getByRole('img', { name: r.categories.listName })).toHaveCount(1);
      await expect(figures(page, 'categories').getByRole('listitem')).toHaveCount(2);

      const charts: [ReportKey, string][] = [
        ['incomeExpenses', r.incomeExpenses.chartName],
        ['netWorth', r.netWorth.chartName],
      ];
      for (const [key, name] of charts) {
        await visit(page, key);
        await expectReport(page, key);
        const figure = page.locator(`figure[aria-label="${name}"]`);
        await expect(figure).toHaveCount(1);
        await expect(figure.locator('figcaption')).not.toBeEmpty();
        await expect(figure.locator('> div[aria-hidden="true"]')).toHaveCount(1);
        await expect(figures(page, key).getByRole('listitem')).not.toHaveCount(0);
      }
    });
  });

  test('a range with nothing shows the empty state that names it and offers to widen it (FR-19, AC-10, AC-17, AC-41)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      stubs.answer('categories', ok('categories', emptyCategoriesFixture(today)));
      stubs.answer('incomeExpenses', ok('incomeExpenses', emptyIncomeExpensesFixture(today)));
      stubs.answer('netWorth', ok('netWorth', emptyNetWorthFixture(today)));
      for (const key of KEYS) {
        await visit(page, key);
        await expect(page.getByText(r.states.emptyTitle)).toBeVisible();
        await expect(page.getByRole('button', { name: r.states.widen })).toBeVisible();
        await expect(page.getByRole('link', { name: r.states.record })).toBeVisible();
        await expect(figures(page, key)).toHaveCount(0);
        await expect(page.getByText(/\d%/)).toHaveCount(0);
      }
    });
  });

  test('loading shows a skeleton with the controls operable, then the figures; a server error has a retry that stays disabled while it runs (FR-19, AC-40, AC-42)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      const slow = gate();
      stubs.answer(
        'categories',
        ok('categories', categoriesFixture(today), { after: slow.opened }),
      );
      await visit(page, 'categories');
      await expect(page.locator('[role="status"][aria-busy="true"]')).toBeVisible();
      await expect(page.getByRole('button', { name: r.range.presets.last3 })).toBeEnabled();
      await expect(dateField(page, 'from')).toBeEnabled();
      slow.open();
      await expectReport(page, 'categories');

      stubs.answer('categories', { kind: 'status', status: 500 });
      await visit(page, 'categories');
      await expect(page.getByText(r.states.errorTitle)).toBeVisible();

      const retryGate = gate();
      stubs.answer(
        'categories',
        ok('categories', categoriesFixture(today), { after: retryGate.opened }),
      );
      await page.getByRole('button', { name: r.states.retry, exact: true }).click();
      await expect(page.getByRole('button', { name: r.states.retrying })).toBeDisabled();
      retryGate.open();
      await expectReport(page, 'categories');
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Filters, address and ranges
// ---------------------------------------------------------------------------------------------

test.describe('filters and ranges', () => {
  test.use({ viewport: DESK });

  test('each screen offers its own controls and the presets request the right range (FR-12, FR-13, AC-24, AC-25, AC-26, AC-28, AC-29)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      stubs.answer('categories', ok('categories', categoriesFixture(today)));
      stubs.answer('incomeExpenses', ok('incomeExpenses', incomeExpensesFixture(today)));
      stubs.answer('netWorth', ok('netWorth', netWorthFixture(today)));

      await visit(page, 'categories');
      await expectReport(page, 'categories');
      await expect(dateField(page, 'from')).toBeVisible();
      await expect(page.getByLabel(r.filters.account, { exact: true })).toBeVisible();
      await expect(page.getByLabel(es.movements.tags.label, { exact: true })).toBeVisible();

      stubs.reset();
      await page.getByRole('button', { name: r.range.presets.last3 }).click();
      await expect.poll(() => stubs.count('categories')).toBe(1);
      const request = stubs.requests('categories')[0];
      expect(request?.searchParams.get('from')).toBe(`${shiftMonth(month, -2)}-01`);
      expect(request?.searchParams.get('to')).toBe(today);

      stubs.reset();
      const tag = page.getByLabel(es.movements.tags.label, { exact: true });
      await tag.fill('vacations2026');
      await tag.press('Enter');
      await expect.poll(() => stubs.count('categories')).toBe(1);
      expect(stubs.requests('categories')[0]?.searchParams.get('tag')).toBe('vacations2026');

      await visit(page, 'incomeExpenses');
      await expectReport(page, 'incomeExpenses');
      await expect(page.getByRole('button', { name: r.range.presets.last12 })).toBeVisible();
      await expect(page.getByRole('button', { name: r.range.presets.last24 })).toHaveCount(0);

      await visit(page, 'netWorth');
      await expectReport(page, 'netWorth');
      await expect(dateField(page, 'from')).toBeVisible();
      await expect(page.getByLabel(r.filters.account, { exact: true })).toHaveCount(0);
      await expect(page.getByLabel(es.movements.tags.label, { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: r.range.presets.last24 })).toBeVisible();
    });
  });

  test('the address ?tag=vacations2026&from=2026-01-01 applies both and from=31-12-2026 is ignored (FR-14, AC-30, AC-31)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      stubs.answer('categories', ok('categories', categoriesFixture(today)));

      await visit(page, 'categories', '?tag=vacations2026&from=2026-01-01');
      await expectReport(page, 'categories');
      await expect(dateField(page, 'from')).toHaveValue('2026-01-01');
      await expect(
        page.getByRole('list', { name: es.movements.tags.chips }).getByText('vacations2026'),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: r.filters.clear })).toBeVisible();
      const applied = stubs.requests('categories').at(-1);
      expect(applied?.searchParams.get('tag')).toBe('vacations2026');
      expect(applied?.searchParams.get('from')).toBe('2026-01-01');

      stubs.reset();
      await visit(page, 'categories', '?tag=vacations2026&from=31-12-2026');
      await expectReport(page, 'categories');
      await expect(dateField(page, 'from')).toHaveValue('');
      await expect(
        page.getByRole('list', { name: es.movements.tags.chips }).getByText('vacations2026'),
      ).toBeVisible();
      const ignored = stubs.requests('categories').at(-1);
      expect(ignored?.searchParams.get('tag')).toBe('vacations2026');
      expect(ignored?.searchParams.has('from')).toBe(false);
    });
  });

  test('a from after the to sends no request and 13 months on income against expenses states the limit (FR-15, AC-32, AC-33)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      stubs.answer('categories', ok('categories', categoriesFixture(today)));
      stubs.answer('incomeExpenses', ok('incomeExpenses', incomeExpensesFixture(today)));

      await visit(page, 'categories');
      await expectReport(page, 'categories');
      await dateField(page, 'to').fill(`${shiftMonth(month, -1)}-15`);
      await expect(page).toHaveURL(new RegExp(`to=${shiftMonth(month, -1)}-15`));
      await expect.poll(() => stubs.count('categories')).toBeGreaterThan(0);
      stubs.reset();
      await dateField(page, 'from').fill(`${shiftMonth(month, -1)}-20`);
      await expect(page.getByText(r.range.errors.fromAfterTo)).toBeVisible();
      await expect(dateField(page, 'from')).toHaveAttribute('aria-invalid', 'true');
      await expect(dateField(page, 'to')).toHaveAttribute('aria-invalid', 'true');
      await page.waitForTimeout(600);
      expect(stubs.count('categories')).toBe(0);

      await visit(page, 'incomeExpenses');
      await expectReport(page, 'incomeExpenses');
      await dateField(page, 'to').fill(`${shiftMonth(month, -1)}-15`);
      await expect(page).toHaveURL(new RegExp(`to=${shiftMonth(month, -1)}-15`));
      await expect.poll(() => stubs.count('incomeExpenses')).toBeGreaterThan(0);
      stubs.reset();
      await dateField(page, 'from').fill(`${shiftMonth(month, -13)}-01`);
      await expect(
        page.getByText('El rango es demasiado largo: el límite es 12 meses.'),
      ).toBeVisible();
      await page.waitForTimeout(600);
      expect(stubs.count('incomeExpenses')).toBe(0);
    });
  });

  test('a 400 on to, a 404 on a filter and a lost session each show their own state (FR-15, FR-23, AC-27, AC-34, AC-48)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      // 400 naming `to`: a message and no figures.
      await visit(page, 'categories');
      await expectReport(page, 'categories');
      stubs.answer('categories', {
        kind: 'error',
        status: 400,
        code: 'VALIDATION_FAILED',
        fields: ['query.to'],
      });
      await page.getByRole('button', { name: r.range.presets.last3 }).click();
      await expect(page.getByText(r.states.badRangeMessage)).toBeVisible();
      await expect(figures(page, 'categories')).toHaveCount(0);

      // 404 for a filter: the message, the filter cleared and a reload that shows the report.
      stubs.answer('categories', ({ url }) =>
        url.searchParams.has('tag')
          ? { kind: 'error', status: 404, code: 'NOT_FOUND' }
          : ok('categories', categoriesFixture(today)),
      );
      await visit(page, 'categories', '?tag=vacations2026');
      await expect(page.getByText(r.states.filterGoneMessage)).toBeVisible();
      await page.getByRole('button', { name: r.states.filterGoneReload }).click();
      await expect(page).toHaveURL(/\/es\/reports\/categories$/);
      await expectReport(page, 'categories');
      await expect(page.getByText(r.states.filterGoneMessage)).toHaveCount(0);
    });

    // 401 that cannot be refreshed: the cookies are gone, so the refresh fails for real.
    await visit(page, 'categories');
    await expectReport(page, 'categories');
    await page.context().clearCookies();
    await page
      .getByRole('navigation', { name: r.tabs.label })
      .getByRole('link', { name: r.tabs.incomeExpenses })
      .click();
    await expect(page).toHaveURL(/\/es\/sign-in\?next=%2Freports%2Fincome-expenses$/);
    await expect(page.getByText(SEEDED_TOTAL)).toHaveCount(0);

    await signInHere(page, email);
    await expect(page).toHaveURL(/\/es\/reports\/income-expenses$/);
    await expectReport(page, 'incomeExpenses');
  });

  test('at 360 px the filters collapse behind one control with the count, and at 1024 px they are open (FR-12, AC-50)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      stubs.answer('categories', ok('categories', categoriesFixture(today)));

      await page.setViewportSize(PHONE);
      await visit(page, 'categories', '?tag=vacations2026');
      await expectReport(page, 'categories');
      const toggle = page.getByRole('button', { name: 'Más filtros (1)' });
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(dateField(page, 'from')).toHaveCount(0);
      await toggle.click();
      await expect(dateField(page, 'from')).toBeVisible();

      await page.setViewportSize({ width: 1024, height: 800 });
      await visit(page, 'categories', '?tag=vacations2026');
      await expectReport(page, 'categories');
      await expect(page.getByRole('button', { name: /^Más filtros/ })).toHaveCount(0);
      await expect(dateField(page, 'from')).toBeVisible();
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Offline, storage and request counts
// ---------------------------------------------------------------------------------------------

test.describe('connection and requests', () => {
  test.use({ viewport: DESK });

  test('offline shows the connection message and no figures; back online, retry shows the report; nothing is stored (FR-20, AC-43, AC-44, NFR-07)', async ({
    page,
  }) => {
    await installOfflineSwitch(page);
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      stubs.answer('categories', ok('categories', markerCategoriesFixture(today)));
      await visit(page, 'categories');
      await expectReport(page, 'categories');
      await expect(page.getByText(MARKER_TOTAL_FORMATTED).first()).toBeVisible();
      expect(
        await findInBrowserStorage(page, [MARKER_TOTAL_MINOR, MARKER_TOTAL_FORMATTED]),
      ).toEqual([]);

      await setReportedOffline(page, true);
      await openTab(page, 'incomeExpenses');
      await expect(page.getByText(r.states.offlineTitle)).toBeVisible();
      await expect(figures(page, 'incomeExpenses')).toHaveCount(0);
      await openTab(page, 'categories');
      await expect(page.getByText(r.states.offlineTitle)).toBeVisible();
      await expect(page.getByText(MARKER_TOTAL_FORMATTED)).toHaveCount(0);

      await setReportedOffline(page, false);
      await page.getByRole('button', { name: r.states.offlineRetry }).click();
      await expect(page.getByText(MARKER_TOTAL_FORMATTED).first()).toBeVisible();
      expect(
        await findInBrowserStorage(page, [MARKER_TOTAL_MINOR, MARKER_TOTAL_FORMATTED]),
      ).toEqual([]);
    });
  });

  test('one filter change sends exactly one report request (NFR-02)', async ({ page }) => {
    test.skip(!PRODUCTION_BUILD, 'next dev runs effects twice; run with E2E_PRODUCTION_BUILD=1');
    await signedIn(page);
    // The home's own requests must be over before the counting starts.
    await page.waitForLoadState('networkidle');
    await withReportStubs(page, async (stubs) => {
      await visit(page, 'categories');
      await expectReport(page, 'categories');
      await page.waitForLoadState('networkidle');
      expect(stubs.count('categories'), 'one request per screen').toBe(1);
      expect(stubs.count('incomeExpenses') + stubs.count('netWorth')).toBe(0);

      stubs.reset();
      await page
        .getByLabel(r.filters.account, { exact: true })
        .selectOption({ label: SECOND_ACCOUNT });
      await expect.poll(() => stubs.count('categories')).toBe(1);
      await page.waitForLoadState('networkidle');
      expect(stubs.count('categories')).toBe(1);

      stubs.reset();
      await page.getByRole('button', { name: r.range.presets.last3 }).click();
      await expect.poll(() => stubs.count('categories')).toBe(1);
      await page.waitForLoadState('networkidle');
      expect(stubs.count('categories')).toBe(1);
    });
  });

  test('two account changes within a second show the answer of the second request only (FR-22, AC-47)', async ({
    page,
  }) => {
    await signedIn(page);
    await withReportStubs(page, async (stubs) => {
      await visit(page, 'categories');
      await expectReport(page, 'categories');

      const select = page.getByLabel(r.filters.account, { exact: true });
      const firstId = await select
        .locator('option', { hasText: SECOND_ACCOUNT })
        .getAttribute('value');
      expect(firstId).not.toBeNull();
      await expect(select.locator('option', { hasText: ACCOUNT })).toHaveCount(1);

      const slow = gate();
      const withTotal = (minor: string) =>
        categoriesFixture(today, {
          total: minor,
          categories: [
            {
              categoryId: '33333333-3333-4333-8333-333333333333',
              name: null,
              defaultKey: 'food',
              amount: minor,
            },
          ],
        });
      stubs.answer('categories', ({ url }) =>
        url.searchParams.get('accountId') === firstId
          ? ok('categories', withTotal('111100'), { after: slow.opened })
          : ok('categories', withTotal('222200')),
      );

      await select.selectOption({ label: SECOND_ACCOUNT });
      await select.selectOption({ label: ACCOUNT });
      await expect(page.getByText(money(222_200, 'ARS')).first()).toBeVisible();

      slow.open();
      await page.waitForTimeout(500);
      await expect(page.getByText(money(222_200, 'ARS')).first()).toBeVisible();
      await expect(page.getByText(money(111_100, 'ARS'))).toHaveCount(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Spanish
// ---------------------------------------------------------------------------------------------

test('Spanish labels, months and number format on all three screens (FR-04, FR-07, FR-08, AC-49)', async ({
  page,
}) => {
  await page.setViewportSize(DESK);
  await signedIn(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');

  await visit(page, 'categories');
  await expectReport(page, 'categories');
  for (const text of [r.categories.total, r.range.presets.thisMonth, r.filters.account]) {
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText(/\d{1,3}(\.\d{3})*,\d{2}\sARS/).first()).toBeVisible();

  await visit(page, 'incomeExpenses');
  await expectReport(page, 'incomeExpenses');
  await expect(
    figures(page, 'incomeExpenses').getByText(monthLabel(month), { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(r.incomeExpenses.income).first()).toBeVisible();
  await expect(page.getByText(/\d{1,3}(\.\d{3})*,\d{2}\sARS/).first()).toBeVisible();

  await visit(page, 'netWorth');
  await expectReport(page, 'netWorth');
  await expect(page.getByText(r.range.presets.last12).first()).toBeVisible();
  await expect(page.getByText(/\d{1,3}(\.\d{3})*,\d{2}\sARS/).first()).toBeVisible();
  await expect(page.getByText(/\b\d+(,\d{3})+\.\d{2}\b/)).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// Widths, themes, targets, keyboard and contrast
// ---------------------------------------------------------------------------------------------

/** The typed fixture of a report with figures, optionally held back until a gate opens. */
function readyAnswer(key: ReportKey, after?: Promise<void>): ReportAnswer {
  const options = after === undefined ? {} : { after };
  switch (key) {
    case 'categories':
      return ok('categories', categoriesFixture(today), options);
    case 'incomeExpenses':
      return ok('incomeExpenses', incomeExpensesFixture(today), options);
    case 'netWorth':
      return ok('netWorth', netWorthFixture(today), options);
  }
}

/** The typed fixture of a report whose range has nothing in it. */
function emptyAnswer(key: ReportKey): ReportAnswer {
  switch (key) {
    case 'categories':
      return ok('categories', emptyCategoriesFixture(today));
    case 'incomeExpenses':
      return ok('incomeExpenses', emptyIncomeExpensesFixture(today));
    case 'netWorth':
      return ok('netWorth', emptyNetWorthFixture(today));
  }
}

function stubAllReady(stubs: ReportStubs): void {
  for (const key of KEYS) stubs.answer(key, readyAnswer(key));
}

const TAB_OF: Record<ReportKey, string> = {
  categories: r.tabs.categories,
  incomeExpenses: r.tabs.incomeExpenses,
  netWorth: r.tabs.netWorth,
};

test.describe('widths and themes (NFR-03, NFR-04, NFR-05)', () => {
  for (const theme of THEMES) {
    test(`widths 360, 768, 1024, 1280 and 1920 in the ${theme} theme: no horizontal scroll, targets of 44 px, keyboard reach and contrast`, async ({
      page,
    }) => {
      test.setTimeout(420_000);
      await signedIn(page, theme);
      await withReportStubs(page, async (stubs) => {
        stubAllReady(stubs);
        for (const width of [360, 768, 1024, 1280, 1920]) {
          await page.setViewportSize({ width, height: 900 });
          for (const key of KEYS) {
            const where = `${key} at ${width} px (${theme})`;
            await visit(page, key);
            await expectReport(page, key);
            await expect(page.locator('html')).toHaveClass(
              theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/,
            );
            await openFilters(page);

            expect(await horizontalOverflow(page), `overflow, ${where}`).toBeLessThanOrEqual(0);
            expect(await undersizedTargets(page), `targets, ${where}`).toEqual([]);
            expect(await unreachableByKeyboard(page), `keyboard, ${where}`).toEqual([]);
            await probeContrast(page, `ready, ${where}`);
          }
        }
      });
    });

    test(`widths 360, 768, 1024, 1280 and 1920 in the ${theme} theme: no horizontal scroll at 200% text (NFR-03)`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await signedIn(page, theme);
      await withReportStubs(page, async (stubs) => {
        stubAllReady(stubs);
        for (const width of [360, 768, 1024, 1280, 1920]) {
          await page.setViewportSize({ width, height: 900 });
          for (const key of KEYS) {
            await visit(page, key);
            await expectReport(page, key);
            await page.evaluate(() => {
              document.documentElement.style.fontSize = '200%';
            });
            expect(
              await horizontalOverflow(page),
              `overflow at 200% text, ${key} at ${width} px (${theme})`,
            ).toBeLessThanOrEqual(0);
            await page.evaluate(() => {
              document.documentElement.style.fontSize = '';
            });
          }
        }
      });
    });

    test(`the loading, empty, error and offline states of every report pass the contrast probe in the ${theme} theme`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await installOfflineSwitch(page);
      await signedIn(page, theme);
      await page.setViewportSize(PHONE);
      await withReportStubs(page, async (stubs) => {
        for (const key of KEYS) {
          const name = (state: string) => `${state}, ${key} (${theme})`;

          const slow = gate();
          stubs.answer(key, readyAnswer(key, slow.opened));
          await visit(page, key);
          await expect(page.locator('[role="status"][aria-busy="true"]')).toBeVisible();
          await probeContrast(page, name('loading'));
          expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
          slow.open();
          await expectReport(page, key);

          stubs.answer(key, emptyAnswer(key));
          await visit(page, key);
          await expect(page.getByText(r.states.emptyTitle)).toBeVisible();
          await probeContrast(page, name('empty'));
          expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

          stubs.answer(key, { kind: 'status', status: 500 });
          await visit(page, key);
          await expect(page.getByText(r.states.errorTitle)).toBeVisible();
          await probeContrast(page, name('error'));
          expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

          stubs.answer(key, readyAnswer(key));
          await visit(page, key);
          await expectReport(page, key);
          await setReportedOffline(page, true);
          const other = KEYS.find((candidate) => candidate !== key) ?? 'categories';
          await openTab(page, other);
          await openTab(page, key);
          await expect(page.getByText(r.states.offlineTitle)).toBeVisible();
          // The tabs fade between their two looks; the probe measures them at rest.
          await page.evaluate(() =>
            Promise.all(document.getAnimations().map((animation) => animation.finished)),
          );
          await probeContrast(page, name('offline'));
          expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
          await setReportedOffline(page, false);
        }
      });
    });
  }
});
