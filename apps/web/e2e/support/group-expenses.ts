import { formatMoney } from '@pesly/shared';
import { expect, type Page } from '@playwright/test';
import { catalogs } from './catalogs';
import { chooseFirstCategory } from './movement-type';
import { chooseSegmentValue } from './segmented';

const es = catalogs.es;
const t = es.groups;
const tAccounts = es.accounts;

/** What the screens print for an ARS amount in minor units, from the formatter the app uses. */
export function ars(minor: bigint): string {
  return formatMoney(minor, 'ARS', 'es');
}

/** Creates an ARS account for the signed-in user; the payer of a group expense needs one. */
export async function createArsAccount(page: Page, name: string): Promise<void> {
  await page.goto('/es/accounts/new');
  await page.getByLabel(tAccounts.fields.name).fill(name);
  await page
    .getByLabel(tAccounts.fields.type)
    .selectOption({ label: tAccounts.types.bank_account });
  await chooseSegmentValue(page, tAccounts.fields.currency, 'ARS');
  await page.getByRole('button', { name: tAccounts.form.submit }).click();
  await expect(page).toHaveURL(/\/es\/accounts$/);
}

export type SplitChoice =
  | { mode: 'equal' }
  | { mode: 'percentage'; values: Record<string, string> }
  | { mode: 'exact'; values: Record<string, string> };

export interface NewGroupExpense {
  groupId: string;
  /** Typed as is, in the es notation. */
  amount: string;
  description: string;
  account: string;
  split: SplitChoice;
}

/** Fills and saves the new expense form as the payer; ends on the group's expenses list. */
export async function recordGroupExpense(page: Page, expense: NewGroupExpense): Promise<void> {
  await page.goto(`/es/groups/${expense.groupId}/expenses/new`);
  const form = t.expenses.form;
  await page.getByLabel(form.fields.amount, { exact: true }).fill(expense.amount);
  // The caller is the payer by default, so the account and personal category are asked for.
  await page
    .getByLabel(form.fields.account, { exact: true })
    .selectOption({ label: expense.account });
  await chooseFirstCategory(page, form.fields.personalCategory);
  await chooseFirstCategory(page, form.fields.category);
  await page.getByLabel(form.fields.description, { exact: true }).fill(expense.description);
  if (expense.split.mode !== 'equal') {
    await page
      .getByRole('radio', { name: t.split.modes[expense.split.mode], exact: true })
      .check({ force: true });
    const field = expense.split.mode === 'percentage' ? t.split.percentage : t.split.exact;
    for (const [name, value] of Object.entries(expense.split.values)) {
      await page.getByLabel(field.field.replace('{name}', name), { exact: true }).fill(value);
    }
  }
  await page.getByRole('button', { name: form.submit }).click();
  await expect(page).toHaveURL(new RegExp(`/es/groups/${expense.groupId}/expenses$`));
}

/** True when the page scrolls horizontally. */
export async function scrollsHorizontally(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}
