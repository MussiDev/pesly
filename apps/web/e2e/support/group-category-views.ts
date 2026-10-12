import { formatMoney } from '../../src/lib/format-amount';
import type { Page, Request } from '@playwright/test';
import { API_URL, groupFacts, sharedGroup, type GroupFacts } from './group-settlements';

const WEB_URL = 'http://localhost:3000';

/** Calls the API with the cookies of the signed-in `page`, as the web client does. */
async function api<T>(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await page.request.fetch(`${API_URL}${path}`, {
    method,
    headers: { 'X-Requested-With': 'argent', Origin: WEB_URL },
    ...(body === undefined ? {} : { data: body }),
  });
  if (!response.ok()) {
    throw new Error(`${method} ${path} answered ${response.status()}: ${await response.text()}`);
  }
  return (response.status() === 204 ? undefined : await response.json()) as T;
}

export type Currency = 'ARS' | 'USD';

export interface SeededExpense {
  id: string;
  version: number;
}

export interface CategoryViewsFixture {
  groupId: string;
  facts: GroupFacts;
  /** Custom group categories created for the test; `old` is archived once it has expenses. */
  categories: { food: string; transport: string; old: string };
  names: { food: string; transport: string; old: string };
}

export const NAMES = {
  food: 'Comida del viaje',
  transport: 'Transporte local',
  old: 'Alojamiento viejo',
} as const;

/** What these screens print for an amount in minor units: the web app's own formatter. */
export function money(minor: bigint, currency: Currency): string {
  return formatMoney(minor, currency, 'es');
}

/** A share in basis points as the es screens print it; a percentage, never money. */
export function share(basisPoints: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(basisPoints / 10000);
}

/** A moment a little in the past, so it is never "in the future" for the server. */
export function aMomentAgo(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

/** The middle of the previous calendar month, safe in any time zone of the test. */
export function inPreviousMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12)).toISOString();
}

/** `Mes de año` as the month select prints it in Spanish. */
export function monthLabel(offsetFromNow: number): string {
  const now = new Date();
  return new Intl.DateTimeFormat('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetFromNow, 1)));
}

/** A creates a group, B joins it, and A gets the accounts and the three categories the checks use. */
export async function categoryViewsGroup(
  pageA: Page,
  pageB: Page,
  name: string,
): Promise<CategoryViewsFixture> {
  const groupId = await sharedGroup(pageA, pageB, name);
  const facts = await groupFacts(pageA, groupId);
  const create = async (categoryName: string, icon: string, color: string): Promise<string> => {
    const created = await api<{ id: string }>(pageA, 'POST', `/groups/${groupId}/categories`, {
      name: categoryName,
      icon,
      color,
    });
    return created.id;
  };
  return {
    groupId,
    facts,
    categories: {
      food: await create(NAMES.food, 'utensils', 'orange'),
      transport: await create(NAMES.transport, 'car', 'blue'),
      old: await create(NAMES.old, 'home', 'violet'),
    },
    names: { ...NAMES },
  };
}

/** Records an expense split equally among the members; amounts are minor units, as text. */
export async function seedCategorizedExpense(
  page: Page,
  fixture: CategoryViewsFixture,
  expense: {
    amount: string;
    currency: Currency;
    description: string;
    categoryId: string;
    occurredAt?: string;
  },
): Promise<SeededExpense> {
  const { facts, groupId } = fixture;
  const created = await api<{ id: string; version: number }>(
    page,
    'POST',
    `/groups/${groupId}/expenses`,
    {
      amount: expense.amount,
      currency: expense.currency,
      occurredAt: expense.occurredAt ?? aMomentAgo(),
      payerMemberId: facts.selfMemberId,
      categoryId: expense.categoryId,
      description: expense.description,
      split: { mode: 'equal', memberIds: facts.members.map((member) => member.id) },
      payerAccount: {
        accountId: expense.currency === 'ARS' ? facts.payer.arsAccountId : facts.payer.usdAccountId,
        categoryId: facts.payer.personalCategoryId,
      },
    },
  );
  return { id: created.id, version: created.version };
}

/** Changes the amount of an expense through the API, as its author would from another device. */
export async function changeExpenseAmount(
  page: Page,
  fixture: CategoryViewsFixture,
  expense: SeededExpense,
  change: { amount: string; description: string; categoryId: string; occurredAt: string },
): Promise<void> {
  await api(page, 'PUT', `/groups/${fixture.groupId}/expenses/${expense.id}`, {
    amount: change.amount,
    occurredAt: change.occurredAt,
    categoryId: change.categoryId,
    description: change.description,
    split: { mode: 'equal', memberIds: fixture.facts.members.map((member) => member.id) },
    baseVersion: expense.version,
  });
}

/** Archives a group category, so the expenses that name it keep it and the pickers drop it. */
export async function archiveGroupCategory(
  page: Page,
  groupId: string,
  categoryId: string,
): Promise<void> {
  await api(page, 'PATCH', `/groups/${groupId}/categories/${categoryId}`, { archived: true });
}

/** The seeded month: three categories in ARS, two in USD, plus one older ARS expense. */
export async function seedMonths(page: Page, fixture: CategoryViewsFixture) {
  const { food, transport, old } = fixture.categories;
  const lunch = await seedCategorizedExpense(page, fixture, {
    amount: '600000',
    currency: 'ARS',
    description: 'Almuerzo del grupo',
    categoryId: food,
  });
  await seedCategorizedExpense(page, fixture, {
    amount: '300000',
    currency: 'ARS',
    description: 'Taxi al aeropuerto',
    categoryId: transport,
  });
  await seedCategorizedExpense(page, fixture, {
    amount: '100000',
    currency: 'ARS',
    description: 'Noche en el hostel',
    categoryId: old,
  });
  await seedCategorizedExpense(page, fixture, {
    amount: '5000',
    currency: 'USD',
    description: 'Cena en dólares',
    categoryId: food,
  });
  await seedCategorizedExpense(page, fixture, {
    amount: '15000',
    currency: 'USD',
    description: 'Alquiler de auto',
    categoryId: transport,
  });
  await seedCategorizedExpense(page, fixture, {
    amount: '400000',
    currency: 'ARS',
    description: 'Supermercado del mes pasado',
    categoryId: food,
    occurredAt: inPreviousMonth(),
  });
  await archiveGroupCategory(page, fixture.groupId, old);
  return { lunch };
}

/**
 * The distinct API requests of one group the page makes from now until `stop()`, by method, path
 * and query. The dev server runs effects twice (React strict mode): the same call twice is one read.
 */
export function countGroupRequests(
  page: Page,
  groupId: string,
): { stop: () => { list: string[]; summary: string[]; group: string[]; options: string[] } } {
  const seen: string[] = [];
  const listener = (request: Request) => {
    const url = new URL(request.url());
    if (url.origin === API_URL && url.pathname.startsWith(`/groups/${groupId}`)) {
      seen.push(`${request.method()} ${url.pathname}${url.search}`);
    }
  };
  page.on('request', listener);
  return {
    stop: () => {
      page.off('request', listener);
      const unique = [...new Set(seen)];
      const base = `GET /groups/${groupId}`;
      return {
        summary: unique.filter((entry) => entry.startsWith(`${base}/expenses/summary`)),
        list: unique.filter(
          (entry) => entry.startsWith(`${base}/expenses`) && !entry.includes('/expenses/summary'),
        ),
        options: unique.filter((entry) => entry.startsWith(`${base}/expense-options`)),
        group: unique.filter((entry) => entry === base),
      };
    },
  };
}
