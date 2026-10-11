import { expect, type Page } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './accounts';
import { catalogs } from './catalogs';

const es = catalogs.es;
const t = es.groups;

/** Registers, verifies and signs in a fresh user on `page`. */
export async function signedInUser(
  page: Page,
  label: string,
  displayName = 'Ana Pérez',
): Promise<void> {
  const email = uniqueEmail(label);
  await registerAndVerify(page, email, displayName);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
}

/** Creates a group through the form and waits until its detail page shows the name. */
export async function createGroup(page: Page, name: string): Promise<string> {
  await page.goto('/es/groups/new');
  await page.getByLabel(t.list.fields.name, { exact: true }).fill(name);
  await page.getByRole('button', { name: t.list.submit }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const match = /\/es\/groups\/([^/?#]+)$/.exec(new URL(page.url()).pathname);
  if (match?.[1] === undefined) throw new Error(`Not on a group page: ${page.url()}`);
  return match[1];
}

/** Asks for an invitation on the open group page and reads the link from the read-only field. */
export async function createInvitationLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: t.invite.create }).click();
  const field = page.getByLabel(t.invite.linkLabel, { exact: true });
  await expect(field).toBeVisible();
  const link = await field.inputValue();
  expect(link).toContain('/groups/join#token=');
  return link;
}

/** Adds a member without an account on the open group page. */
export async function addGhostMember(page: Page, name: string): Promise<void> {
  await page.getByLabel(t.invite.ghost.nameLabel, { exact: true }).fill(name);
  await page.getByRole('button', { name: t.invite.ghost.submit }).click();
  await expect(page.getByRole('list', { name: t.detail.membersTitle })).toContainText(name);
}

/** True when the page scrolls horizontally. */
export async function scrollsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}
