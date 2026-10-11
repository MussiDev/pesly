import { expect, type Page } from '@playwright/test';
import { createGroup, createInvitationLink } from './groups';

export const API_URL = 'http://localhost:4000';
const WEB_URL = 'http://localhost:3000';

interface GroupMember {
  id: string;
  displayName: string | null;
}

export interface GroupFacts {
  selfMemberId: string;
  members: GroupMember[];
  categoryId: string;
  /** The caller's own accounts and personal category: a payer must say where the money left. */
  payer: { arsAccountId: string; usdAccountId: string; personalCategoryId: string };
}

/** Calls the API with the cookies of the signed-in `page`, as the web client does. */
async function api<T>(
  page: Page,
  method: 'GET' | 'POST',
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
  // A 204 has no body.
  return (response.status() === 204 ? undefined : await response.json()) as T;
}

/** Creates the caller's ARS and USD accounts and picks an expense category, through the API. */
async function payerSetup(page: Page): Promise<GroupFacts['payer']> {
  const ars = await api<{ id: string }>(page, 'POST', '/accounts', {
    name: 'Banco ARS',
    type: 'bank_account',
    currency: 'ARS',
  });
  const usd = await api<{ id: string }>(page, 'POST', '/accounts', {
    name: 'Banco USD',
    type: 'bank_account',
    currency: 'USD',
  });
  const categories = await api<{ items: { id: string; kind: string; archived: boolean }[] }>(
    page,
    'GET',
    '/categories',
  );
  const category = categories.items.find((item) => item.kind === 'expense' && !item.archived);
  if (category === undefined) throw new Error('The user has no expense category');
  return { arsAccountId: ars.id, usdAccountId: usd.id, personalCategoryId: category.id };
}

/** A moment a little in the past, so it is never "in the future" for the server. */
function aMomentAgo(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

/** A creates a group and B joins it through the invitation link; returns the group id. */
export async function sharedGroup(pageA: Page, pageB: Page, name: string): Promise<string> {
  const groupId = await createGroup(pageA, name);
  const link = await createInvitationLink(pageA);
  await pageB.goto(link);
  await expect(pageB).toHaveURL(new RegExp(`/es/groups/${groupId}$`));
  await expect(pageB.getByRole('heading', { level: 1, name })).toBeVisible();
  return groupId;
}

/** The caller's member id, the members and one category of the group, read from the API. */
export async function groupFacts(page: Page, groupId: string): Promise<GroupFacts> {
  const options = await api<{
    selfMemberId: string;
    members: GroupMember[];
    categories: { id: string }[];
  }>(page, 'GET', `/groups/${groupId}/expense-options`);
  const category = options.categories[0];
  if (category === undefined) throw new Error('The group has no category to seed with');
  return {
    selfMemberId: options.selfMemberId,
    members: options.members,
    categoryId: category.id,
    payer: await payerSetup(page),
  };
}

export function memberIdByName(facts: GroupFacts, name: string): string {
  const member = facts.members.find((candidate) => candidate.displayName === name);
  if (member === undefined) throw new Error(`No member named ${name}`);
  return member.id;
}

/**
 * Seeds a debt: `payerPage`'s user pays an expense that is split equally among every member, so
 * each of the others owes their share to the payer. Amounts are minor units, as text.
 */
export async function seedExpense(
  payerPage: Page,
  groupId: string,
  facts: GroupFacts,
  expense: { amount: string; currency: 'ARS' | 'USD'; description: string },
): Promise<void> {
  await api(payerPage, 'POST', `/groups/${groupId}/expenses`, {
    amount: expense.amount,
    currency: expense.currency,
    occurredAt: aMomentAgo(),
    payerMemberId: facts.selfMemberId,
    categoryId: facts.categoryId,
    description: expense.description,
    split: { mode: 'equal', memberIds: facts.members.map((member) => member.id) },
    payerAccount: {
      accountId: expense.currency === 'ARS' ? facts.payer.arsAccountId : facts.payer.usdAccountId,
      categoryId: facts.payer.personalCategoryId,
    },
  });
}

/** Seeds one recorded payment from the signed-in user to `toMemberId`. */
export async function seedSettlement(
  payerPage: Page,
  groupId: string,
  facts: GroupFacts,
  settlement: { toMemberId: string; amount: string; currency: 'ARS' | 'USD' },
): Promise<void> {
  await api(payerPage, 'POST', `/groups/${groupId}/settlements`, {
    kind: 'single',
    fromMemberId: facts.selfMemberId,
    toMemberId: settlement.toMemberId,
    currency: settlement.currency,
    amount: settlement.amount,
    occurredAt: aMomentAgo(),
  });
}

/** Leaves the group through the API, as if done from another device. */
export async function leaveGroup(page: Page, groupId: string): Promise<void> {
  await api(page, 'POST', `/groups/${groupId}/leave`);
}
