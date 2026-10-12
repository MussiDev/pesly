import { DEFAULT_CATEGORIES, defaultCategoryName } from '@pesly/shared';
import { expect, type Locator, type Page, type Route } from '@playwright/test';
import type { DashboardResponse } from '../../src/lib/dashboard-contract';
import { registerAndVerify, signIn, uniqueEmail } from './accounts';
import { catalogs } from './catalogs';
import { movementIdsOf } from './database';
import { readyDashboard } from './dashboard-fixtures';
import { chooseCategory, chooseMovementType } from './movement-type';
import {
  ACCOUNT_OPTION,
  createAccount,
  createAccountAndMovement,
  t as movementsCopy,
} from './offline-visit';

export const es = catalogs.es;

export const API_ORIGIN = 'http://localhost:4000';
export const WEB_ORIGIN = 'http://localhost:3000';
export const THEME_STORAGE_KEY = 'pesly-theme';
export const MIN_TARGET = 44;

/** The dashboard's two figure paths (FR-18). */
export type FigurePath = '/dashboard' | '/reports/net-worth';

// ---------------------------------------------------------------------------------------------
// The dashboard stub
// ---------------------------------------------------------------------------------------------

/** What the stubbed `GET /dashboard` answers next. */
export type DashboardAnswer =
  | { kind: 'ok'; body: DashboardResponse }
  /** An error status with a body the client cannot read as an API error: it reads INTERNAL. */
  | { kind: 'status'; status: number }
  /** The request never reaches a server: the client reads NETWORK. */
  | { kind: 'disconnected' };

export interface DashboardStub {
  /** How many `GET /dashboard` requests the stub answered. */
  served(): number;
  respondWith(answer: DashboardAnswer): void;
  /** Answers with the ready fixture and these top-level overrides. */
  show(overrides?: Partial<DashboardResponse>): void;
}

function corsHeaders(route: Route): Record<string, string> {
  return {
    'access-control-allow-origin': route.request().headers().origin ?? WEB_ORIGIN,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type, x-requested-with',
    'access-control-allow-methods': 'GET, OPTIONS',
    vary: 'Origin',
  };
}

/**
 * TODO(09b): slice 09b (`GET /dashboard`) is not merged on this branch, so the browser specs serve
 * that one path from a typed fixture that the app's own provisional contract parser accepts
 * (`apps/web/src/lib/dashboard-contract.ts`). Accounts, movements and `GET /reports/net-worth`
 * stay real. When 09b merges, delete this helper and `dashboard-fixtures.ts` and seed the real
 * data (a budget, a recurring payment due in 3 days, a closed statement due in 2 days) instead.
 *
 * The page calls the API from another origin with credentials, so the answers carry the CORS
 * headers the real API sends and the preflight is answered here too.
 */
export async function stubDashboard(
  page: Page,
  overrides: Partial<DashboardResponse> = {},
): Promise<DashboardStub> {
  let answer: DashboardAnswer = { kind: 'ok', body: readyDashboard(overrides) };
  let served = 0;

  await page.route(
    (url) => url.origin === API_ORIGIN && url.pathname === '/dashboard',
    async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: corsHeaders(route) });
        return;
      }
      served += 1;
      if (answer.kind === 'disconnected') {
        await route.abort('internetdisconnected');
      } else if (answer.kind === 'status') {
        await route.fulfill({
          status: answer.status,
          headers: corsHeaders(route),
          contentType: 'application/json',
          body: '{}',
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: corsHeaders(route),
          contentType: 'application/json',
          body: JSON.stringify(answer.body),
        });
      }
    },
  );

  return {
    served: () => served,
    respondWith: (next) => {
      answer = next;
    },
    show: (next = {}) => {
      answer = { kind: 'ok', body: readyDashboard(next) };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Request counters
// ---------------------------------------------------------------------------------------------

/** Paths that carry financial figures; the dashboard may ask for none of them besides its two. */
const OTHER_FIGURE_PREFIXES = [
  '/accounts',
  '/movements',
  '/budgets',
  '/recurring',
  '/groups',
  '/credit-cards',
  '/goals',
  '/investments',
  '/exchange-rates',
  '/categories',
  '/reports',
];

export interface FigureRequests {
  /** GET requests seen at the route for one of the two dashboard paths. */
  count(path: FigurePath): number;
  /** GET paths of every other figure endpoint that was requested. */
  others(): string[];
  /** While true the net worth series request is aborted: the chart's own failure (FR-17). */
  failSeries(failing: boolean): void;
  reset(): void;
}

/**
 * Counts the requests at the route, reading only the method and the path of each. Register it
 * AFTER `stubDashboard`: the later route runs first and hands the request on with `fallback`, so
 * the stub still answers `/dashboard` and the real API still answers the rest.
 */
export async function watchFigureRequests(page: Page): Promise<FigureRequests> {
  const seen: string[] = [];
  let failingSeries = false;

  await page.route(
    (url) => url.origin === API_ORIGIN,
    async (route) => {
      const request = route.request();
      if (request.method() !== 'GET') {
        await route.fallback();
        return;
      }
      const { pathname } = new URL(request.url());
      seen.push(pathname);
      if (failingSeries && pathname === '/reports/net-worth') {
        await route.abort('failed');
        return;
      }
      await route.fallback();
    },
  );

  return {
    count: (path) => seen.filter((seenPath) => seenPath === path).length,
    others: () =>
      seen.filter(
        (path) =>
          path !== '/dashboard' &&
          path !== '/reports/net-worth' &&
          OTHER_FIGURE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)),
      ),
    failSeries: (failing) => {
      failingSeries = failing;
    },
    reset: () => {
      seen.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Offline after a load
// ---------------------------------------------------------------------------------------------

/**
 * Lets a test flip what `navigator.onLine` reports without a reload. A real network cut cannot be
 * used for the out-of-date notice: the only way back to the home is a document load, which drops
 * the in-memory answers of the session (D6) the notice is made from. Call it before navigating.
 */
export async function installOfflineSwitch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = window as unknown as { __e2eOffline?: boolean };
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => scope.__e2eOffline !== true,
    });
  });
}

export async function setReportedOffline(page: Page, offline: boolean): Promise<void> {
  await page.evaluate((value) => {
    (window as unknown as { __e2eOffline?: boolean }).__e2eOffline = value;
  }, offline);
}

function navigation(page: Page): Locator {
  return page.getByRole('navigation', { name: es.app.nav.label });
}

/** Leaves the home and comes back through the navigation, so the container mounts again. */
export async function leaveAndReturnHome(page: Page): Promise<void> {
  await navigation(page).getByRole('link', { name: es.app.nav.movements, exact: true }).click();
  await expect(page).toHaveURL(/\/es\/movements$/);
  await navigation(page).getByRole('link', { name: es.app.nav.home, exact: true }).click();
  await expect(page).toHaveURL(/\/es$/);
}

// ---------------------------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------------------------

const categoryOf = (kind: 'expense' | 'income'): string => {
  const entry = DEFAULT_CATEGORIES.find((item) => item.kind === kind && item.parentKey === null);
  if (entry === undefined) throw new Error(`No default ${kind} category`);
  return defaultCategoryName(entry.key, 'es');
};

/** `YYYY-MM-DDTHH:mm` in the browser's local time, as the movement form expects. */
function inputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function recordMovement(
  page: Page,
  entry: { type: 'expense' | 'income'; amount: string; occurredAt?: Date; rate?: string },
): Promise<void> {
  await page.goto('/es/movements/new');
  await page
    .getByLabel(movementsCopy.fields.account, { exact: true })
    .selectOption({ label: ACCOUNT_OPTION });
  await chooseMovementType(page, movementsCopy.fields.type, movementsCopy.types[entry.type]);
  await chooseCategory(page, movementsCopy.fields.category, categoryOf(entry.type));
  await page.getByLabel(movementsCopy.fields.amount, { exact: true }).fill(entry.amount);
  if (entry.occurredAt !== undefined) {
    await page
      .getByLabel(movementsCopy.fields.occurredAt, { exact: true })
      .fill(inputValue(entry.occurredAt));
  }
  if (entry.rate !== undefined) {
    await page.getByLabel(movementsCopy.fields.rate, { exact: true }).fill(entry.rate);
  }
  await page.getByRole('button', { name: movementsCopy.form.submit }).click();
  await expect(
    page.getByRole('status').filter({ hasText: movementsCopy.saved.title }),
  ).toBeVisible();
}

/**
 * Registers and signs in a user with an ARS account and a USD account, an expense and an income
 * this month and last month. Everything goes through the real API; the dashboard answer is the
 * stub's. Leaves the page signed in and returns the address for the database helpers.
 */
export async function seedDashboardUser(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  await createAccountAndMovement(page);
  await createAccount(page, 'Dólares', 'USD');
  const lastMonth = new Date(Date.now() - 35 * 86_400_000);
  await recordMovement(page, { type: 'income', amount: '2500,00', rate: '1500,00' });
  await recordMovement(page, { type: 'expense', amount: '50,00', occurredAt: lastMonth });
  await recordMovement(page, {
    type: 'income',
    amount: '1500,00',
    occurredAt: lastMonth,
    rate: '1500,00',
  });
  return email;
}

/** Registers a user with nothing: no account and no movement. Ends signed out. */
export async function registerNewUser(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await registerAndVerify(page, email);
  return email;
}

/**
 * Puts one failed movement in the signed-in user's device queue, as a rejected sync would leave
 * it. The user must have opened the app once so its local database exists; the home must be
 * reloaded for the dashboard to read it.
 */
export async function seedFailedMovement(page: Page, email: string): Promise<void> {
  const { accountId, categoryId } = await movementIdsOf(email);
  await page.evaluate(
    async ({ accountId: account, categoryId: category }) => {
      const pointer = JSON.parse(localStorage.getItem('pesly.session') ?? 'null') as {
        userId: string;
      } | null;
      if (pointer === null) throw new Error('The app has not written the session pointer yet');
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(`pesly-${pointer.userId}`);
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error('Could not open the local database'));
        };
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('queue', 'readwrite');
        const id = crypto.randomUUID();
        transaction.objectStore('queue').put({
          id,
          createdAt: new Date().toISOString(),
          rejection: { code: 'VALIDATION_FAILED' },
          request: {
            id,
            type: 'expense',
            accountId: account,
            categoryId: category,
            amount: '1000',
            occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
            rate: { source: 'manual', value: '12000000' },
          },
        });
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onerror = () => {
          reject(transaction.error ?? new Error('Could not write the queue'));
        };
      });
      database.close();
    },
    { accountId, categoryId },
  );
}

// ---------------------------------------------------------------------------------------------
// Page checks
// ---------------------------------------------------------------------------------------------

/** The home is ready when the net worth card, the figure of record, is on screen. */
export async function expectReady(page: Page): Promise<void> {
  await expect(page.getByRole('region', { name: es.dashboard.netWorth.label })).toBeVisible();
}

/** Stores the theme the page opens with, before any script of the app runs. */
export async function openWithTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_STORAGE_KEY, theme] as const,
  );
}

/** How many pixels the document is wider than the window. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
      document.documentElement.clientWidth,
  );
}

/** The visible navigation landmarks that are wider inside than their own box. */
export async function overflowingNavigations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('nav')]
      .filter((nav) => nav.checkVisibility())
      .filter((nav) => nav.scrollWidth > nav.clientWidth)
      .map((nav) => nav.dataset.slot ?? 'nav'),
  );
}

/** A visible box that sits inside the window's width. */
export async function expectWithinWidth(locator: Locator, width: number): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, 'the element has a box').not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 0.5);
}

/**
 * Every visible interactive element and its hit area, in CSS pixels, for the ones under 44 px.
 * Exclusions, as in the design-system spec: the skip link and any `sr-only` element, and a
 * checkbox or radio, whose area is its label's box.
 */
export async function undersizedTargets(page: Page): Promise<string[]> {
  return page.evaluate((min) => {
    const selector =
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="slider"], [tabindex]:not([tabindex="-1"])';
    const found: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.closest('nextjs-portal')) continue;
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      if (el.matches('a[href="#main-content"]') || el.classList.contains('sr-only')) continue;
      let width = el.getBoundingClientRect().width;
      let height = el.getBoundingClientRect().height;
      if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) {
        const label = el.labels?.[0]?.getBoundingClientRect();
        width = Math.max(width, label?.width ?? 0);
        height = Math.max(height, label?.height ?? 0);
      }
      if (width < min - 0.5 || height < min - 0.5) {
        const name = el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 40);
        found.push(
          `<${el.tagName.toLowerCase()}> "${name}" ${width.toFixed(1)}x${height.toFixed(1)}`,
        );
      }
    }
    return found;
  }, MIN_TARGET);
}

/**
 * Tabs through the page and names the visible interactive elements the keyboard never reached.
 * A radio group is one stop (its arrows move inside it), so radios are not expected one by one.
 */
export async function unreachableByKeyboard(page: Page): Promise<string[]> {
  const total = await page.evaluate(() => {
    const selector =
      'a[href], button:not(:disabled), select, textarea, input:not([type="hidden"]):not([type="radio"]), [role="slider"], [tabindex]:not([tabindex="-1"])';
    let count = 0;
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.closest('nextjs-portal')) continue;
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      if (el.matches('a[href="#main-content"]') || el.classList.contains('sr-only')) continue;
      el.dataset.e2eStop = String(count);
      count += 1;
    }
    return count;
  });
  const reached = new Set<string>();
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  for (let press = 0; press < total + 20; press += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.e2eStop ?? null,
    );
    if (stop !== null) reached.add(stop);
  }
  return page.evaluate(
    (seen) => {
      const reachedStops = new Set(seen);
      return [...document.querySelectorAll<HTMLElement>('[data-e2e-stop]')]
        .filter((el) => !reachedStops.has(el.dataset.e2eStop ?? ''))
        .map(
          (el) =>
            `<${el.tagName.toLowerCase()}> "${(el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 40)}"`,
        );
    },
    [...reached],
  );
}
