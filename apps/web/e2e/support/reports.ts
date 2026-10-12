import {
  DEFAULT_CATEGORIES,
  defaultCategoryName,
  expensesByCategoryResponseSchema,
  formatMinorUnits,
  incomeExpensesResponseSchema,
  netWorthResponseSchema,
  type ErrorCode,
  type ExpensesByCategoryResponse,
  type IncomeExpensesResponse,
  type NetWorthResponse,
} from '@pesly/shared';
import { expect, type Page, type Route } from '@playwright/test';
import { PASSWORD, registerAndVerify, signIn, uniqueEmail } from './accounts';
import { catalogs } from './catalogs';
import { chooseCategory, chooseMovementType } from './movement-type';
import { createAccount, t as movementsCopy } from './offline-visit';

export const API_ORIGIN = 'http://localhost:4000';
export const WEB_ORIGIN = 'http://localhost:3000';
export const TIME_ZONE = 'America/Cordoba';

export type ReportKey = 'categories' | 'incomeExpenses' | 'netWorth';

/** The path each report is read from. */
export const REPORT_PATH: Record<ReportKey, string> = {
  categories: '/reports/expenses-by-category',
  incomeExpenses: '/reports/income-expenses',
  netWorth: '/reports/net-worth',
};

/** The address each report screen lives at (without the locale). */
export const REPORT_ROUTE: Record<ReportKey, string> = {
  categories: '/es/reports/categories',
  incomeExpenses: '/es/reports/income-expenses',
  netWorth: '/es/reports/net-worth',
};

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

/** `YYYY-MM-DD` today in the time zone the specs run in, as the app computes it. */
export function todayInCordoba(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** `YYYY-MM` shifted by a number of months (negative goes back). */
export function shiftMonth(month: string, delta: number): string {
  const [year = 0, number = 1] = month.split('-').map(Number);
  const index = year * 12 + (number - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The last day of a `YYYY-MM` month. */
export function lastDayOf(month: string): string {
  const [year = 0, number = 1] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** An amount as the Spanish screens print it, ready to match (the code follows a no-break space). */
export function money(minor: bigint | number | string, currency: 'ARS' | 'USD'): RegExp {
  const text = formatMinorUnits(BigInt(minor), 'es').replace(/[.+*?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${text}\\s${currency}`);
}

/** A `YYYY-MM` month as the Spanish lists name it, for example "octubre de 2026". */
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('es', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

// ---------------------------------------------------------------------------------------------
// Typed fixtures
// ---------------------------------------------------------------------------------------------

/** Fails the test (not the page) when a fixture no longer matches the shared definition. */
function checked<T>(schema: { parse: (value: unknown) => T }, name: string, fixture: unknown): T {
  try {
    return schema.parse(fixture);
  } catch (error) {
    throw new Error(`The ${name} fixture no longer matches its shared response definition`, {
      cause: error,
    });
  }
}

const ID = {
  food: '11111111-1111-4111-8111-111111111111',
  transport: '22222222-2222-4222-8222-222222222222',
} as const;

/** AC-08: a total of 200,000.00 ARS with Food at 120,000.00 and Transport at 80,000.00. */
export function categoriesFixture(
  today: string,
  overrides: Partial<ExpensesByCategoryResponse> = {},
): ExpensesByCategoryResponse {
  const base: ExpensesByCategoryResponse = {
    currency: 'ARS',
    from: `${today.slice(0, 7)}-01`,
    to: today,
    total: '20000000',
    categories: [
      { categoryId: ID.food, name: null, defaultKey: 'food', amount: '12000000' },
      { categoryId: ID.transport, name: null, defaultKey: 'transport', amount: '8000000' },
    ],
    unconvertedShareCount: 0,
    unconvertedInstallmentCount: 0,
  };
  return checked(expensesByCategoryResponseSchema, 'expenses by category', {
    ...base,
    ...overrides,
  });
}

/** A range with nothing in it (AC-10, AC-41). */
export function emptyCategoriesFixture(today: string): ExpensesByCategoryResponse {
  return categoriesFixture(today, { total: '0', categories: [] });
}

/** Twelve months ending in today's month; every month has income and expenses. */
export function incomeExpensesFixture(
  today: string,
  overrides: Partial<IncomeExpensesResponse> = {},
): IncomeExpensesResponse {
  const current = today.slice(0, 7);
  const months = Array.from({ length: 12 }, (_, index) => ({
    month: shiftMonth(current, index - 11),
    // The current month is October-like: income 800,000.00 against expenses 240,000.00 (AC-16);
    // the month before spends more than it earns, so its result carries a minus sign.
    income: index === 11 ? '80000000' : index === 10 ? '10000000' : '50000000',
    expenses: index === 11 ? '24000000' : index === 10 ? '15000000' : '20000000',
  }));
  return checked(incomeExpensesResponseSchema, 'income against expenses', {
    currency: 'ARS',
    from: `${shiftMonth(current, -11)}-01`,
    to: today,
    months,
    unconvertedShareCount: 0,
    unconvertedInstallmentCount: 0,
    ...overrides,
  });
}

/**
 * Six month ends. The third one has no stored rate (`no_rate`, a gap in the line) and the last
 * has investments that are not fully counted. `2026-06-30` style dates are built from today.
 */
export function netWorthFixture(
  today: string,
  overrides: Partial<NetWorthResponse> = {},
): NetWorthResponse {
  const current = today.slice(0, 7);
  const points = Array.from({ length: 6 }, (_, index) => {
    const date = index === 5 ? today : lastDayOf(shiftMonth(current, index - 5));
    const gap = index === 2;
    return {
      date,
      ars: String(100_000_000 + index * 10_000_000),
      usd: String(50_000 + index * 1_000),
      total: gap ? null : String(180_000_000 + index * 15_000_000),
      reason: gap ? ('no_rate' as const) : null,
      investmentsIncomplete: index === 5,
    };
  });
  return checked(netWorthResponseSchema, 'net worth', {
    currency: 'ARS',
    from: `${shiftMonth(current, -5)}-01`,
    to: today,
    points,
    ...overrides,
  });
}

/** No month converts (AC-22): every total is null with its reason. */
export function unconvertedNetWorthFixture(today: string): NetWorthResponse {
  const base = netWorthFixture(today);
  return checked(netWorthResponseSchema, 'net worth without conversion', {
    ...base,
    points: base.points.map((point) => ({ ...point, total: null, reason: 'no_rate' as const })),
  });
}

/** Twelve months with nothing in them (AC-17). */
export function emptyIncomeExpensesFixture(today: string): IncomeExpensesResponse {
  const base = incomeExpensesFixture(today);
  return checked(incomeExpensesResponseSchema, 'empty income against expenses', {
    ...base,
    months: base.months.map((month) => ({ ...month, income: '0', expenses: '0' })),
  });
}

/** A range with no point at all. */
export function emptyNetWorthFixture(today: string): NetWorthResponse {
  return netWorthFixture(today, { points: [] });
}

/** A figure that appears nowhere else, so a leak into storage is found by searching for it. */
export const MARKER_TOTAL_MINOR = '7351842960';
export const MARKER_TOTAL_FORMATTED = '73.518.429,60';

export function markerCategoriesFixture(today: string): ExpensesByCategoryResponse {
  return categoriesFixture(today, {
    total: MARKER_TOTAL_MINOR,
    categories: [
      { categoryId: ID.food, name: null, defaultKey: 'food', amount: MARKER_TOTAL_MINOR },
    ],
  });
}

// ---------------------------------------------------------------------------------------------
// Report stubs
// ---------------------------------------------------------------------------------------------

interface Bodies {
  categories: ExpensesByCategoryResponse;
  incomeExpenses: IncomeExpensesResponse;
  netWorth: NetWorthResponse;
}

const SCHEMAS = {
  categories: expensesByCategoryResponseSchema,
  incomeExpenses: incomeExpensesResponseSchema,
  netWorth: netWorthResponseSchema,
} as const;

/** What a stubbed report request answers. */
export type ReportAnswer =
  | { kind: 'ok'; body: unknown; after?: Promise<void> | undefined }
  /** A typed API error, as the real API sends it. */
  | { kind: 'error'; status: number; code: ErrorCode; fields?: string[] }
  /** An error status with a body the client cannot read as an API error. */
  | { kind: 'status'; status: number }
  /** The request never reaches a server. */
  | { kind: 'disconnected' };

/** An `ok` answer whose body is parsed with the shared definition first. */
export function ok<K extends ReportKey>(
  key: K,
  body: Bodies[K],
  options: { after?: Promise<void> } = {},
): ReportAnswer {
  return { kind: 'ok', body: checked<unknown>(SCHEMAS[key], key, body), after: options.after };
}

/** A promise a test opens later, to keep a stubbed answer in flight. */
export function gate(): { opened: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

export interface ReportRequest {
  url: URL;
  /** How many requests of this report came before this one. */
  index: number;
}

/** Decides one request; `undefined` hands it on to the real API. */
export type ReportHandler = (request: ReportRequest) => ReportAnswer | undefined;

export interface ReportStubs {
  /** Every request URL seen for the report, in order, whether stubbed or not. */
  requests(key: ReportKey): URL[];
  count(key: ReportKey): number;
  /** Forgets the requests counted so far. */
  reset(): void;
  /** Sets how the next requests of a report are answered; `undefined` goes back to the API. */
  answer(key: ReportKey, handler: ReportAnswer | ReportHandler | undefined): void;
  remove(): Promise<void>;
}

const activeStubs = new Set<ReportStubs>();

/** How many stubs a test left installed; the spec fails in `afterEach` when it is not zero. */
export function leftoverStubs(): number {
  return activeStubs.size;
}

/** Removes every stub still installed (the spec calls it after counting them). */
export async function removeLeftoverStubs(): Promise<void> {
  await Promise.all([...activeStubs].map((stub) => stub.remove()));
}

function corsHeaders(route: Route): Record<string, string> {
  return {
    'access-control-allow-origin': route.request().headers().origin ?? WEB_ORIGIN,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type, x-requested-with',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'Origin',
  };
}

const KEY_OF_PATH = new Map<string, ReportKey>(
  (Object.entries(REPORT_PATH) as [ReportKey, string][]).map(([key, path]) => [path, key]),
);

/**
 * Counts every report request at the route and answers the ones a handler claims; the rest go on
 * to the real API. The page calls the API from another origin with credentials, so the answers
 * carry the CORS headers the real API sends and the preflight is answered here too.
 */
export async function stubReports(page: Page): Promise<ReportStubs> {
  const seen: Record<ReportKey, URL[]> = { categories: [], incomeExpenses: [], netWorth: [] };
  const handlers = new Map<ReportKey, ReportAnswer | ReportHandler>();

  const matches = (url: URL) => url.origin === API_ORIGIN && KEY_OF_PATH.has(url.pathname);
  const handle = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = KEY_OF_PATH.get(url.pathname);
    if (key === undefined) {
      await route.fallback();
      return;
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders(route) });
      return;
    }
    if (request.method() !== 'GET') {
      await route.fallback();
      return;
    }
    const index = seen[key].length;
    seen[key].push(url);
    const handler = handlers.get(key);
    const answer = typeof handler === 'function' ? handler({ url, index }) : handler;
    if (answer === undefined) {
      await route.fallback();
      return;
    }
    switch (answer.kind) {
      case 'disconnected':
        await route.abort('internetdisconnected');
        return;
      case 'status':
        await route.fulfill({
          status: answer.status,
          headers: corsHeaders(route),
          contentType: 'application/json',
          body: '{}',
        });
        return;
      case 'error':
        await route.fulfill({
          status: answer.status,
          headers: corsHeaders(route),
          contentType: 'application/json',
          body: JSON.stringify({
            code: answer.code,
            ...(answer.fields === undefined ? {} : { fields: answer.fields }),
          }),
        });
        return;
      case 'ok':
        await answer.after;
        await route.fulfill({
          status: 200,
          headers: corsHeaders(route),
          contentType: 'application/json',
          body: JSON.stringify(answer.body),
        });
        return;
    }
  };

  await page.route(matches, handle);

  const stubs: ReportStubs = {
    requests: (key) => [...seen[key]],
    count: (key) => seen[key].length,
    reset: () => {
      for (const key of Object.keys(seen) as ReportKey[]) seen[key].length = 0;
    },
    answer: (key, handler) => {
      if (handler === undefined) handlers.delete(key);
      else handlers.set(key, handler);
    },
    remove: async () => {
      activeStubs.delete(stubs);
      await page.unroute(matches, handle);
    },
  };
  activeStubs.add(stubs);
  return stubs;
}

/** Installs the stubs, runs the test body and always removes them, even when the body fails. */
export async function withReportStubs<T>(
  page: Page,
  body: (stubs: ReportStubs) => Promise<T>,
): Promise<T> {
  const stubs = await stubReports(page);
  try {
    return await body(stubs);
  } finally {
    await stubs.remove();
  }
}

// ---------------------------------------------------------------------------------------------
// Seeds (real accounts and movements through the app)
// ---------------------------------------------------------------------------------------------

export const ACCOUNT = 'Caja';
export const SECOND_ACCOUNT = 'Ahorros';

/** Eight expenses of this month, one per category, from the largest to the smallest (AC-08, AC-11). */
export const SEEDED_EXPENSES = [
  '500,00',
  '400,00',
  '300,00',
  '200,00',
  '100,00',
  '50,00',
  '20,00',
  '10,00',
] as const;
export const SEEDED_TOTAL = '1.580,00';
/** Whole-percent shares of those amounts: rounded down, with the leftover on the largest (D5). */
export const SEEDED_SHARES = [35, 25, 18, 12, 6, 3, 1, 0] as const;
export const SEEDED_INCOME = '3000,00';

function expenseCategories(): string[] {
  const roots = DEFAULT_CATEGORIES.filter(
    (entry) => entry.kind === 'expense' && entry.parentKey === null,
  );
  if (roots.length < SEEDED_EXPENSES.length) throw new Error('Not enough default categories');
  return roots
    .slice(0, SEEDED_EXPENSES.length)
    .map((entry) => defaultCategoryName(entry.key, 'es'));
}

/** The names the seeded categories show in Spanish, largest amount first. */
export const SEEDED_CATEGORY_NAMES = expenseCategories();

function incomeCategory(): string {
  const entry = DEFAULT_CATEGORIES.find(
    (item) => item.kind === 'income' && item.parentKey === null,
  );
  if (entry === undefined) throw new Error('No default income category');
  return defaultCategoryName(entry.key, 'es');
}

/** `YYYY-MM-DDTHH:mm` in the browser's local time, as the movement form expects. */
function inputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function record(
  page: Page,
  entry: { type: 'expense' | 'income'; category: string; amount: string; occurredAt?: Date },
): Promise<void> {
  await page.goto('/es/movements/new');
  await page
    .getByLabel(movementsCopy.fields.account, { exact: true })
    .selectOption({ label: `${ACCOUNT} (ARS)` });
  await chooseMovementType(page, movementsCopy.fields.type, movementsCopy.types[entry.type]);
  await chooseCategory(page, movementsCopy.fields.category, entry.category);
  await page.getByLabel(movementsCopy.fields.amount, { exact: true }).fill(entry.amount);
  if (entry.occurredAt !== undefined) {
    await page
      .getByLabel(movementsCopy.fields.occurredAt, { exact: true })
      .fill(inputValue(entry.occurredAt));
  }
  await page.getByRole('button', { name: movementsCopy.form.submit }).click();
  await expect(
    page.getByRole('status').filter({ hasText: movementsCopy.saved.title }),
  ).toBeVisible();
}

/**
 * Registers and signs in a user with two ARS accounts, eight expenses this month in eight
 * categories, an income this month, and an expense and an income about 40 days ago (a month
 * that spends more than it earns). Everything goes through the real API. Leaves the page signed
 * in on the home and returns the address.
 */
export async function seedReportsUser(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  await createAccount(page, ACCOUNT);
  await createAccount(page, SECOND_ACCOUNT);
  for (const [index, amount] of SEEDED_EXPENSES.entries()) {
    await record(page, {
      type: 'expense',
      category: SEEDED_CATEGORY_NAMES[index] ?? '',
      amount,
    });
  }
  await record(page, { type: 'income', category: incomeCategory(), amount: SEEDED_INCOME });
  const earlier = new Date(Date.now() - 40 * 86_400_000);
  await record(page, {
    type: 'expense',
    category: SEEDED_CATEGORY_NAMES[0] ?? '',
    amount: '200,00',
    occurredAt: earlier,
  });
  await record(page, {
    type: 'income',
    category: incomeCategory(),
    amount: '100,00',
    occurredAt: earlier,
  });
  return email;
}

/** Signs in through the form shown at the current address, which may carry `?next=`. */
export async function signInHere(page: Page, email: string): Promise<void> {
  const copy = catalogs.es.auth;
  await page.getByLabel(copy.fields.email).fill(email);
  await page.getByLabel(copy.fields.password).fill(PASSWORD);
  await page.getByRole('button', { name: copy.signIn.submit }).click();
}

// ---------------------------------------------------------------------------------------------
// Storage scan (NFR-07)
// ---------------------------------------------------------------------------------------------

/**
 * Looks for any of `needles` in everything the page's origin keeps: `localStorage`,
 * `sessionStorage`, every IndexedDB store and the Cache Storage (request URLs and bodies).
 * Returns where each one was found.
 */
export async function findInBrowserStorage(
  page: Page,
  needles: readonly string[],
): Promise<string[]> {
  return page.evaluate(async (words) => {
    const found: string[] = [];
    const check = (where: string, text: string) => {
      for (const word of words) if (text.includes(word)) found.push(`${where}: ${word}`);
    };
    for (const [name, area] of [
      ['localStorage', localStorage],
      ['sessionStorage', sessionStorage],
    ] as const) {
      for (let index = 0; index < area.length; index += 1) {
        const key = area.key(index) ?? '';
        check(`${name} key ${key}`, key);
        check(`${name} ${key}`, area.getItem(key) ?? '');
      }
    }
    const databases = await indexedDB.databases();
    for (const info of databases) {
      if (info.name === undefined) continue;
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name as string);
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error('Could not open a database'));
        };
      });
      for (const store of [...database.objectStoreNames]) {
        const rows = await new Promise<unknown[]>((resolve, reject) => {
          const request = database.transaction(store, 'readonly').objectStore(store).getAll();
          request.onsuccess = () => {
            resolve(request.result);
          };
          request.onerror = () => {
            reject(request.error ?? new Error('Could not read a store'));
          };
        });
        check(
          `indexedDB ${info.name}/${store}`,
          JSON.stringify(rows, (_key: string, value: unknown) =>
            typeof value === 'bigint' ? value.toString() : value,
          ),
        );
      }
      database.close();
    }
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        check(`cache ${name} url ${request.url}`, request.url);
        const response = await cache.match(request);
        if (response !== undefined)
          check(`cache ${name} body ${request.url}`, await response.clone().text());
      }
    }
    return found;
  }, needles);
}
