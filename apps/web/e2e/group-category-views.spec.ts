import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { catalogs } from './support/catalogs';
import { resetAttemptLimits } from './support/database';
import {
  aMomentAgo,
  categoryViewsGroup,
  changeExpenseAmount,
  countGroupRequests,
  monthLabel,
  money,
  NAMES,
  seedMonths,
  share,
  type CategoryViewsFixture,
  type SeededExpense,
} from './support/group-category-views';
import { scrollsHorizontally, signedInUser } from './support/groups';

const es = catalogs.es;
const en = catalogs.en;
const t = es.groups;
const cv = t.categoryViews;

test.use({ locale: 'es-AR', timezoneId: 'America/Cordoba' });

const LOCALE = { locale: 'es-AR', timezoneId: 'America/Cordoba' } as const;

/** The summary region of the page, scoped to the main landmark (the shell has alerts of its own). */
function summaryOf(page: Page): Locator {
  return page.getByRole('main').getByRole('region', { name: cv.summarySection.title });
}

/** The block of one currency inside the summary. */
function currencyBlock(page: Page, currency: 'ARS' | 'USD'): Locator {
  return summaryOf(page)
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 3, name: currency, exact: true }) });
}

function monthSelect(page: Page): Locator {
  return page.locator('label', { hasText: cv.month.label }).locator('select');
}

function filterGroup(page: Page): Locator {
  return page.getByRole('group', { name: cv.filter.label, exact: true });
}

function activeFilters(page: Page): Locator {
  return page.getByRole('group', { name: cv.filter.activeLabel, exact: true });
}

function expenseList(page: Page): Locator {
  return page.getByRole('list', { name: t.expenses.label, exact: true });
}

function row(page: Page, description: string): Locator {
  return expenseList(page).getByRole('listitem').filter({ hasText: description });
}

async function openExpenses(page: Page, groupId: string, locale: 'es' | 'en' = 'es') {
  await page.goto(`/${locale}/groups/${groupId}/expenses`);
  await expect(
    page.getByRole('heading', { level: 1, name: catalogs[locale].groups.expenses.title }),
  ).toBeVisible();
}

function flatten(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  if (value === null || typeof value !== 'object') return [[prefix, String(value)]];
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

test.describe.serial('group category views', () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let fixture: CategoryViewsFixture;
  let lunch: SeededExpense;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    await resetAttemptLimits();
    contextA = await browser.newContext(LOCALE);
    contextB = await browser.newContext(LOCALE);
    pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await signedInUser(pageA, 'gcv-a', 'Ana Pérez');
    await signedInUser(pageB, 'gcv-b', 'Bruno Gómez');
    fixture = await categoryViewsGroup(pageA, pageB, 'Viaje por categorías');
    ({ lunch } = await seedMonths(pageA, fixture));
  });

  test.afterAll(async () => {
    await contextA.close();
    await contextB.close();
  });

  test('rows show icon, color and name, an archived category is marked, and the detail shows the same chip (AC-01, AC-03, AC-18)', async () => {
    await openExpenses(pageA, fixture.groupId);
    await expect(expenseList(pageA).getByRole('listitem')).toHaveCount(5);

    const food = row(pageA, 'Almuerzo del grupo').locator('[data-slot="category-chip"]');
    await expect(food).toContainText(NAMES.food);
    await expect(food.locator('[data-icon="utensils"][data-color="orange"]')).toHaveCount(1);
    await expect(food.locator('svg').first()).toBeVisible();

    const transport = row(pageA, 'Taxi al aeropuerto').locator('[data-slot="category-chip"]');
    await expect(transport).toContainText(NAMES.transport);
    await expect(transport.locator('[data-icon="car"][data-color="blue"]')).toHaveCount(1);

    const old = row(pageA, 'Noche en el hostel').locator('[data-slot="category-chip"]');
    await expect(old).toContainText(NAMES.old);
    await expect(old).toContainText(cv.chip.archived);
    await expect(food).not.toContainText(cv.chip.archived);

    await pageA.goto(`/es/groups/${fixture.groupId}/expenses/${lunch.id}/edit`);
    const detail = pageA.getByRole('main').locator('[data-slot="category-chip"]');
    await expect(detail).toContainText(NAMES.food);
    await expect(detail.locator('[data-icon="utensils"][data-color="orange"]')).toHaveCount(1);
    await expect(
      pageA.getByRole('main').locator('span', { hasText: new RegExp(`^${cv.detail.label}$`) }),
    ).toBeVisible();
  });

  test('the summary shows ARS and USD as separate lists ordered by total, with text amounts and percentages (AC-10 to AC-13, AC-23)', async () => {
    await openExpenses(pageA, fixture.groupId);

    const ars = currencyBlock(pageA, 'ARS');
    await expect(ars).toContainText(money(1000000n, 'ARS'));
    const arsLines = ars.getByRole('listitem');
    await expect(arsLines).toHaveCount(3);
    await expect(arsLines.nth(0)).toContainText(NAMES.food);
    await expect(arsLines.nth(0)).toContainText(money(600000n, 'ARS'));
    await expect(arsLines.nth(0)).toContainText(share(6000));
    await expect(arsLines.nth(1)).toContainText(NAMES.transport);
    await expect(arsLines.nth(1)).toContainText(money(300000n, 'ARS'));
    await expect(arsLines.nth(1)).toContainText(share(3000));
    await expect(arsLines.nth(2)).toContainText(NAMES.old);
    await expect(arsLines.nth(2)).toContainText(cv.chip.archived);
    await expect(arsLines.nth(2)).toContainText(money(100000n, 'ARS'));
    await expect(arsLines.nth(2)).toContainText(share(1000));

    const usd = currencyBlock(pageA, 'USD');
    await expect(usd).toContainText(money(20000n, 'USD'));
    const usdLines = usd.getByRole('listitem');
    await expect(usdLines).toHaveCount(2);
    await expect(usdLines.nth(0)).toContainText(NAMES.transport);
    await expect(usdLines.nth(0)).toContainText(money(15000n, 'USD'));
    await expect(usdLines.nth(0)).toContainText(share(7500));
    await expect(usdLines.nth(1)).toContainText(NAMES.food);
    await expect(usdLines.nth(1)).toContainText(share(2500));

    // The archived category is offered in the filter while the month has a line for it (AC-19).
    await expect(filterGroup(pageA).getByRole('button', { name: NAMES.old })).toBeVisible();
    await expect(pageA.getByRole('main').getByRole('alert')).toHaveCount(0);
  });

  test('tapping a summary line filters the list, shows the removable chip and the same total; clearing restores the month (AC-05, AC-14, AC-15)', async () => {
    await openExpenses(pageA, fixture.groupId);
    await currencyBlock(pageA, 'ARS').getByRole('button', { name: NAMES.food }).click();

    await expect(expenseList(pageA).getByRole('listitem')).toHaveCount(2);
    await expect(row(pageA, 'Almuerzo del grupo')).toBeVisible();
    await expect(row(pageA, 'Cena en dólares')).toBeVisible();
    await expect(activeFilters(pageA)).toContainText(NAMES.food);
    await expect(
      activeFilters(pageA).getByRole('button', {
        name: cv.filter.remove.replace('{name}', NAMES.food),
      }),
    ).toBeVisible();

    const totals = pageA.getByRole('region', { name: cv.list.filteredTotal.label });
    await expect(totals).toContainText(money(600000n, 'ARS'));
    await expect(totals).toContainText(money(5000n, 'USD'));

    // Tapping another line replaces the filter (AC-14).
    await currencyBlock(pageA, 'USD').getByRole('button', { name: NAMES.transport }).click();
    await expect(expenseList(pageA).getByRole('listitem')).toHaveCount(2);
    await expect(row(pageA, 'Taxi al aeropuerto')).toBeVisible();
    await expect(activeFilters(pageA)).not.toContainText(NAMES.food);

    await pageA.getByRole('button', { name: cv.filter.clear, exact: true }).click();
    await expect(activeFilters(pageA)).toHaveCount(0);
    await expect(expenseList(pageA).getByRole('listitem')).toHaveCount(5);
  });

  test('the previous month reloads list and summary; a month with no expenses and a filter with no match show their states (AC-08, AC-16, AC-17)', async () => {
    await openExpenses(pageA, fixture.groupId);
    await pageA.getByRole('button', { name: cv.month.previous }).click();

    await expect(monthSelect(pageA).locator('option:checked')).toHaveText(
      new RegExp(monthLabel(-1), 'i'),
    );
    await expect(expenseList(pageA).getByRole('listitem')).toHaveCount(1);
    await expect(row(pageA, 'Supermercado del mes pasado')).toBeVisible();
    await expect(currencyBlock(pageA, 'ARS')).toContainText(money(400000n, 'ARS'));
    await expect(currencyBlock(pageA, 'USD')).toHaveCount(0);
    // The archived category has no line in this month, so it is not offered (AC-19).
    await expect(filterGroup(pageA).getByRole('button', { name: NAMES.old })).toHaveCount(0);

    // A filter that matches nothing in the month.
    await filterGroup(pageA).getByRole('button', { name: NAMES.transport }).click();
    await expect(pageA.getByText(cv.list.noMatch.title)).toBeVisible();
    await pageA.getByRole('button', { name: cv.list.noMatch.clear, exact: true }).click();
    await expect(row(pageA, 'Supermercado del mes pasado')).toBeVisible();

    // A month with no expenses at all.
    await pageA.getByRole('button', { name: cv.month.previous }).click();
    await expect(pageA.getByText(cv.list.monthEmpty.description)).toBeVisible();
    await expect(pageA.getByText(cv.summarySection.empty.description)).toBeVisible();
    await expect(expenseList(pageA)).toHaveCount(0);
  });

  test('the first load makes 3 list requests and 1 summary request; a filter change makes 1 and a month change 2 (NFR-02)', async () => {
    const counter = countGroupRequests(pageA, fixture.groupId);
    await openExpenses(pageA, fixture.groupId);
    await expect(currencyBlock(pageA, 'ARS')).toBeVisible();
    await expect(expenseList(pageA).getByRole('listitem')).toHaveCount(5);
    const first = counter.stop();
    expect(first.group).toHaveLength(1);
    expect(first.options).toHaveLength(1);
    expect(first.list).toHaveLength(1);
    expect(first.summary).toHaveLength(1);

    const filter = countGroupRequests(pageA, fixture.groupId);
    await currencyBlock(pageA, 'ARS').getByRole('button', { name: NAMES.food }).click();
    await expect(expenseList(pageA).getByRole('listitem')).toHaveCount(2);
    const afterFilter = filter.stop();
    expect(afterFilter.list).toHaveLength(1);
    expect(afterFilter.list[0]).toContain('categoryIds=');
    expect(afterFilter.summary).toHaveLength(0);
    expect(afterFilter.group).toHaveLength(0);
    expect(afterFilter.options).toHaveLength(0);

    const month = countGroupRequests(pageA, fixture.groupId);
    await pageA.getByRole('button', { name: cv.month.previous }).click();
    await expect(expenseList(pageA).getByRole('listitem')).toHaveCount(1);
    await expect(currencyBlock(pageA, 'ARS')).toContainText(money(400000n, 'ARS'));
    const afterMonth = month.stop();
    expect(afterMonth.list).toHaveLength(1);
    expect(afterMonth.summary).toHaveLength(1);
    expect(afterMonth.group).toHaveLength(0);
    expect(afterMonth.options).toHaveLength(0);
  });

  test('the page with the summary, the filter, the empty states and the error state fits 360 px (NFR-01)', async () => {
    await pageA.setViewportSize({ width: 360, height: 740 });
    try {
      await openExpenses(pageA, fixture.groupId);
      await expect(currencyBlock(pageA, 'USD')).toBeVisible();
      expect(await scrollsHorizontally(pageA), 'summary').toBe(false);

      await currencyBlock(pageA, 'ARS').getByRole('button', { name: NAMES.food }).click();
      await expect(activeFilters(pageA)).toContainText(NAMES.food);
      expect(await scrollsHorizontally(pageA), 'filtered').toBe(false);

      // No match in the previous month.
      await pageA.getByRole('button', { name: cv.month.previous }).click();
      await pageA
        .getByRole('button', { name: cv.filter.remove.replace('{name}', NAMES.food) })
        .click();
      await filterGroup(pageA).getByRole('button', { name: NAMES.transport }).click();
      await expect(pageA.getByText(cv.list.noMatch.title)).toBeVisible();
      expect(await scrollsHorizontally(pageA), 'no match').toBe(false);

      // A month with no expenses.
      await pageA.getByRole('button', { name: cv.filter.clear, exact: true }).click();
      await pageA.getByRole('button', { name: cv.month.previous }).click();
      await expect(pageA.getByText(cv.list.monthEmpty.description)).toBeVisible();
      expect(await scrollsHorizontally(pageA), 'empty month').toBe(false);

      // The summary fails; the list keeps working.
      await pageA.route(/\/groups\/[^/]+\/expenses\/summary/, (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Something broke.' }),
        }),
      );
      await openExpenses(pageA, fixture.groupId);
      await expect(pageA.getByRole('main').getByRole('alert')).toBeVisible();
      await expect(
        pageA.getByRole('main').getByRole('button', { name: es.app.retry }),
      ).toBeVisible();
      await expect(expenseList(pageA).getByRole('listitem')).toHaveCount(5);
      expect(await scrollsHorizontally(pageA), 'summary error').toBe(false);
    } finally {
      await pageA.unroute(/\/groups\/[^/]+\/expenses\/summary/);
      await pageA.setViewportSize({ width: 1280, height: 720 });
    }
  });

  test('the catalogs have the same keys, none empty, and the page renders in both languages (NFR-05, AC-22)', async () => {
    const spanish = flatten(es.groups.categoryViews);
    const english = flatten(en.groups.categoryViews);
    expect(spanish.map(([key]) => key).sort()).toEqual(english.map(([key]) => key).sort());
    expect(spanish.length).toBeGreaterThan(10);
    for (const [key, value] of [...spanish, ...english]) {
      expect(value.trim(), key).not.toBe('');
    }

    await openExpenses(pageA, fixture.groupId, 'en');
    await expect(
      pageA
        .getByRole('main')
        .getByRole('region', { name: en.groups.categoryViews.summarySection.title }),
    ).toBeVisible();
    await expect(
      pageA.locator('label', { hasText: en.groups.categoryViews.month.label }).locator('select'),
    ).toBeVisible();
    await expect(
      pageA.getByRole('group', { name: en.groups.categoryViews.filter.label, exact: true }),
    ).toBeVisible();
    await expect(pageA.getByRole('main')).toContainText(NAMES.food);

    await openExpenses(pageA, fixture.groupId, 'es');
    await expect(summaryOf(pageA)).toBeVisible();
  });

  test('a summary edit is reflected after the author changes an expense and reloads (AC-29)', async () => {
    await openExpenses(pageA, fixture.groupId);
    await expect(currencyBlock(pageA, 'ARS')).toContainText(money(1000000n, 'ARS'));

    await changeExpenseAmount(pageA, fixture, lunch, {
      amount: '700000',
      description: 'Almuerzo del grupo',
      categoryId: fixture.categories.food,
      occurredAt: aMomentAgo(),
    });
    await pageA.reload();

    const ars = currencyBlock(pageA, 'ARS');
    await expect(ars).toContainText(money(1100000n, 'ARS'));
    await expect(ars.getByRole('listitem').nth(0)).toContainText(money(700000n, 'ARS'));
    // 700000 of 1100000 is 63.6363...%, rounded half up in basis points.
    await expect(ars.getByRole('listitem').nth(0)).toContainText(share(6364));
  });

  test('a user who is not in the group gets the not-found state on the expenses page (AC-28)', async ({
    browser,
  }) => {
    const outsiderContext = await browser.newContext(LOCALE);
    try {
      const outsider = await outsiderContext.newPage();
      await signedInUser(outsider, 'gcv-outsider');
      await outsider.goto(`/es/groups/${fixture.groupId}/expenses`);
      await expect(outsider.getByText(t.detail.notFound.title)).toBeVisible();
      await expect(outsider.getByText(NAMES.food)).toHaveCount(0);
    } finally {
      await outsiderContext.close();
    }
  });
});
