import { expect, type Locator, type Page } from '@playwright/test';
import { catalogs } from './catalogs';

const t = catalogs.es.goals;

export interface NewGoal {
  name: string;
  /** Typed as is, in the es notation. */
  target: string;
  /** The label of the account to link; the goal is unlinked when omitted. */
  account?: string;
}

/** Fills and saves the new goal form; ends on the goals list. */
export async function createGoal(page: Page, goal: NewGoal): Promise<void> {
  await page.goto('/es/goals/new');
  await page.getByLabel(t.form.name, { exact: true }).fill(goal.name);
  await page.getByLabel(t.form.targetAmount, { exact: true }).fill(goal.target);
  if (goal.account !== undefined) {
    await page.getByRole('checkbox', { name: t.form.account }).check();
    await page
      .getByRole('combobox', { name: t.form.account })
      .selectOption({ label: goal.account });
  }
  await page.getByRole('button', { name: t.form.submit }).click();
  await expect(page).toHaveURL(/\/es\/goals$/);
}

/** Opens a goal from the list by its name and returns its id. */
export async function openGoal(page: Page, name: string): Promise<string> {
  await page.goto('/es/goals');
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const match = /\/es\/goals\/([^/?#]+)$/.exec(new URL(page.url()).pathname);
  if (match?.[1] === undefined) throw new Error(`Not on a goal page: ${page.url()}`);
  return match[1];
}

/** The contribution or withdrawal form of the open goal, found by its heading. */
export function entryForm(page: Page, kind: 'contribution' | 'withdrawal'): Locator {
  const title = kind === 'contribution' ? t.entries.contributionTitle : t.entries.withdrawalTitle;
  return page.locator('form', { has: page.getByRole('heading', { name: title }) });
}

/** Types an amount in one of the entry forms and submits it. */
export async function submitEntry(
  page: Page,
  kind: 'contribution' | 'withdrawal',
  amount: string,
): Promise<void> {
  const form = entryForm(page, kind);
  await form.getByLabel(t.entries.amount, { exact: true }).fill(amount);
  await form
    .getByRole('button', {
      name: kind === 'contribution' ? t.entries.submitContribution : t.entries.submitWithdrawal,
    })
    .click();
}
