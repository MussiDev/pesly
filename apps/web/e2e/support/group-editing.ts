import type { Page, Request, Route } from '@playwright/test';
import { API_URL, type GroupFacts } from './group-settlements';

const WEB_URL = 'http://localhost:3000';

/** Calls the API with the cookies of the signed-in `page`, as the web client does. */
async function api<T>(
  page: Page,
  method: 'GET' | 'POST' | 'PATCH',
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

/**
 * Records an expense through the API and answers its id. `memberIds` are the members it is split
 * equally among; the caller pays it.
 */
export async function createExpense(
  page: Page,
  groupId: string,
  facts: GroupFacts,
  expense: { amount: string; description: string; memberIds: string[] },
): Promise<string> {
  const created = await api<{ id: string }>(page, 'POST', `/groups/${groupId}/expenses`, {
    amount: expense.amount,
    currency: 'ARS',
    occurredAt: new Date(Date.now() - 60_000).toISOString(),
    payerMemberId: facts.selfMemberId,
    categoryId: facts.categoryId,
    description: expense.description,
    split: { mode: 'equal', memberIds: expense.memberIds },
    payerAccount: {
      accountId: facts.payer.arsAccountId,
      categoryId: facts.payer.personalCategoryId,
    },
  });
  return created.id;
}

export interface ExpenseOnServer {
  id: string;
  description: string;
  amount: string;
}

/** The expenses of the group as the server holds them, newest first. */
export async function serverExpenses(page: Page, groupId: string): Promise<ExpenseOnServer[]> {
  const result = await api<{ items: ExpenseOnServer[] }>(
    page,
    'GET',
    `/groups/${groupId}/expenses?limit=100`,
  );
  return result.items;
}

/** The ids of the settlements of the group, newest first. */
export async function serverSettlementIds(page: Page, groupId: string): Promise<string[]> {
  const result = await api<{ items: { id: string }[] }>(
    page,
    'GET',
    `/groups/${groupId}/settlements?limit=100`,
  );
  return result.items.map((item) => item.id);
}

/** Makes `memberId` an admin of the group; the caller must be one. */
export async function makeAdmin(page: Page, groupId: string, memberId: string): Promise<void> {
  await api(page, 'POST', `/groups/${groupId}/members/${memberId}/admin`);
}

/**
 * Makes every write to a group record fail at the network, as if the connection dropped: the
 * change stays on the device and the pass keeps it waiting. Reads still work. Answers a function
 * that lifts the block and asks the shell for a pass.
 */
export async function blockGroupWrites(page: Page): Promise<() => Promise<void>> {
  const matches = (url: URL) =>
    url.origin === API_URL && /^\/groups\/[^/]+\/(expenses|settlements)\/[^/]+$/.test(url.pathname);
  const handler = async (route: Route) => {
    if (route.request().method() === 'GET') await route.fallback();
    else await route.abort('failed');
  };
  await page.route(matches, handler);
  return async () => {
    await page.unroute(matches, handler);
    await requestPass(page);
  };
}

/** Asks the shell to start a sync pass, the way a queued change does. */
export async function requestPass(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pesly:movement-queued'));
  });
}

/** The names of the IndexedDB databases the app made on this origin. */
export async function databaseNames(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name ?? ''),
  );
}

/** The distinct API requests whose path starts with one of `prefixes`, from now until `stop()`. */
export function countApiRequests(page: Page, prefixes: string[]): { stop: () => string[] } {
  const seen: string[] = [];
  const listener = (request: Request) => {
    const url = new URL(request.url());
    if (url.origin === API_URL && prefixes.some((prefix) => url.pathname.startsWith(prefix))) {
      seen.push(`${request.method()} ${url.pathname}`);
    }
  };
  page.on('request', listener);
  return {
    stop: () => {
      page.off('request', listener);
      // The dev server runs effects twice (React strict mode): the same call twice is one read.
      return [...new Set(seen)];
    },
  };
}
