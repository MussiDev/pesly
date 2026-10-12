import { expect, type Locator, type Page, type Request } from '@playwright/test';
import { API_URL } from './group-settlements';
import { withE2eDatabase } from './database';

const WEB_URL = 'http://localhost:3000';

/** Calls the API with the cookies of the signed-in `page`; the caller reads the status itself. */
export async function rawApi(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: () => Promise<unknown> }> {
  const response = await page.request.fetch(`${API_URL}${path}`, {
    method,
    headers: { 'X-Requested-With': 'argent', Origin: WEB_URL },
    ...(body === undefined ? {} : { data: body }),
  });
  return { status: response.status(), json: () => response.json() as Promise<unknown> };
}

export async function api<T>(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await rawApi(page, method, path, body);
  if (response.status >= 400) {
    throw new Error(
      `${method} ${path} answered ${response.status}: ${JSON.stringify(await response.json())}`,
    );
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export interface SenderSetup {
  accountId: string;
  categoryId: string;
}

/** An ARS account named "Caja" and an expense category of the signed-in user, through the API. */
export async function senderSetup(page: Page): Promise<SenderSetup> {
  const account = await api<{ id: string }>(page, 'POST', '/accounts', {
    name: 'Caja',
    type: 'cash',
    currency: 'ARS',
    openingBalance: '10000000',
  });
  const categories = await api<{ items: { id: string; kind: string; archived: boolean }[] }>(
    page,
    'GET',
    '/categories',
  );
  const category = categories.items.find((item) => item.kind === 'expense' && !item.archived);
  if (category === undefined) throw new Error('The user has no expense category');
  return { accountId: account.id, categoryId: category.id };
}

/**
 * The setup with a custom personal category (no default key), which has no equivalent in any group,
 * so a send without a chosen category falls back to the group's Other expenses category.
 */
export async function withCustomCategory(page: Page, setup: SenderSetup): Promise<SenderSetup> {
  const created = await api<{ id: string }>(page, 'POST', '/categories', {
    name: 'Gasto propio',
    kind: 'expense',
    icon: 'ellipsis',
    color: 'slate',
  });
  return { ...setup, categoryId: created.id };
}

/** Records an expense movement of `amount` minor units, a minute ago; `note` is optional. */
export async function createExpenseMovement(
  page: Page,
  setup: SenderSetup,
  amount: string,
  note?: string,
): Promise<string> {
  const created = await api<{ id: string }>(page, 'POST', '/movements', {
    type: 'expense',
    accountId: setup.accountId,
    categoryId: setup.categoryId,
    amount,
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    ...(note === undefined ? {} : { note }),
    rate: { source: 'automatic' },
  });
  return created.id;
}

/** Sends a movement to the group through the API with the equal split among every member. */
export async function sendViaApi(page: Page, groupId: string, movementId: string): Promise<void> {
  const options = await api<{ members: { id: string }[] }>(
    page,
    'GET',
    `/groups/${groupId}/expense-options`,
  );
  await api(page, 'POST', `/groups/${groupId}/expenses/from-movement`, {
    movementId,
    split: { mode: 'equal', memberIds: options.members.map((m) => m.id) },
  });
}

export async function accountBalance(page: Page, accountId: string): Promise<string> {
  return (await api<{ balance: string }>(page, 'GET', `/accounts/${accountId}`)).balance;
}

export async function movementTotal(page: Page): Promise<number> {
  return (await api<{ total: number }>(page, 'GET', '/movements?limit=1')).total;
}

export interface ServerExpense {
  id: string;
  amount: string;
  description: string;
  payerMovementId: string | null;
  version: number;
  shares: { memberId: string; amount: string }[];
}

export async function groupExpenses(page: Page, groupId: string): Promise<ServerExpense[]> {
  return (
    await api<{ items: ServerExpense[] }>(page, 'GET', `/groups/${groupId}/expenses?limit=100`)
  ).items;
}

export async function deleteGroupExpense(
  page: Page,
  groupId: string,
  expense: ServerExpense,
): Promise<void> {
  await api(
    page,
    'DELETE',
    `/groups/${groupId}/expenses/${expense.id}?baseVersion=${expense.version}`,
  );
}

interface GroupCategory {
  id: string;
  defaultKey: string | null;
  archivedAt: string | null;
}

export async function groupCategories(page: Page, groupId: string): Promise<GroupCategory[]> {
  return api<GroupCategory[]>(page, 'GET', `/groups/${groupId}/categories`);
}

/** Archives the group's "Other expenses" category through the API (the caller is an admin). */
export async function archiveOtherExpenses(page: Page, groupId: string): Promise<void> {
  const other = (await groupCategories(page, groupId)).find(
    (category) => category.defaultKey === 'other-expenses',
  );
  if (other === undefined) throw new Error('The group has no Other expenses category');
  await api(page, 'PATCH', `/groups/${groupId}/categories/${other.id}`, { archived: true });
}

/** Removes the "Other expenses" row of a group with no expense, so the send must create it. */
export async function removeOtherExpenses(groupId: string): Promise<void> {
  await withE2eDatabase((client) =>
    client.query(
      `delete from group_categories where group_id = $1 and default_key = 'other-expenses'`,
      [groupId],
    ),
  );
}

/** The API requests of the movement and group endpoints a page makes, in order. */
export function recordApiRequests(page: Page): {
  mark: () => number;
  since: (mark: number) => string[];
  stop: () => void;
} {
  const seen: string[] = [];
  const listener = (request: Request) => {
    const url = new URL(request.url());
    if (url.origin !== API_URL) return;
    if (!/^\/(movements|groups|accounts|categories)/.test(url.pathname)) return;
    seen.push(`${request.method()} ${url.pathname}`);
  };
  page.on('request', listener);
  return {
    mark: () => seen.length,
    // The dev server runs effects twice (React strict mode): the same call twice is one read.
    since: (mark) => [...new Set(seen.slice(mark))],
    stop: () => {
      page.off('request', listener);
    },
  };
}

/** Counts every interaction a person makes; the flows tap through it. */
export function tapCounter(): { tap: (target: Locator) => Promise<void>; count: () => number } {
  let taps = 0;
  return {
    tap: async (target) => {
      taps += 1;
      await target.click();
    },
    count: () => taps,
  };
}

export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const scrolls = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(scrolls).toBe(false);
}
