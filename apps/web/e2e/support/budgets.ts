import { DEFAULT_CATEGORIES, defaultCategoryName } from '@pesly/shared';
import { expect, type Page } from '@playwright/test';
import { registerAndVerify, signIn, uniqueEmail } from './accounts';
import { catalogs } from './catalogs';
import { withE2eDatabase } from './database';

const t = catalogs.es.budgets;

/** The time zone the specs run in; the seeded budgets take effect from the current month there. */
const TIME_ZONE = 'America/Argentina/Cordoba';

/** The Spanish names of the default expense categories that have no parent. */
export const EXPENSE_CATEGORIES: readonly string[] = DEFAULT_CATEGORIES.filter(
  (item) => item.kind === 'expense' && item.parentKey === null,
).map((item) => defaultCategoryName(item.key, 'es'));

export interface NewBudget {
  name: string;
  /** Typed as is, in the es notation. */
  amount: string;
  /** Category labels to tick. */
  categories: readonly string[];
  rollover?: boolean;
}

/** Registers, verifies and signs in a fresh user; returns the address for the database helpers. */
export async function signedInEmail(page: Page, label: string): Promise<string> {
  const email = uniqueEmail(label);
  await registerAndVerify(page, email);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/es$/);
  return email;
}

/** Opens the new budget form and fills it, without saving. */
export async function fillBudgetForm(page: Page, budget: NewBudget): Promise<void> {
  await page.goto('/es/budgets/new');
  await page.getByLabel(t.form.name, { exact: true }).fill(budget.name);
  await page.getByLabel(t.form.amount, { exact: true }).fill(budget.amount);
  for (const category of budget.categories) {
    await page.getByLabel(category, { exact: true }).check();
  }
  if (budget.rollover === true) {
    await page.getByRole('checkbox', { name: t.form.rollover }).check();
  }
}

export async function saveBudgetForm(page: Page): Promise<void> {
  await page.getByRole('button', { name: t.form.submit }).click();
}

/** Fills and saves the new budget form with the default thresholds; ends on the budgets list. */
export async function createBudget(page: Page, budget: NewBudget): Promise<void> {
  await fillBudgetForm(page, budget);
  await saveBudgetForm(page);
  await expect(page).toHaveURL(/\/es\/budgets$/);
}

/** Opens a budget from the list by its name and returns its id. */
export async function openBudget(page: Page, name: string): Promise<string> {
  await page.goto('/es/budgets');
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const match = /\/es\/budgets\/([^/?#]+)$/.exec(new URL(page.url()).pathname);
  if (match?.[1] === undefined) throw new Error(`Not on a budget page: ${page.url()}`);
  return match[1];
}

/**
 * Gives `email` `count` budgets of 1,000.00 ARS over its first expense category, as the 50 a user
 * may hold; the user must have opened a category screen so its default categories exist.
 */
export async function seedBudgets(email: string, count: number): Promise<void> {
  if (!Number.isInteger(count) || count <= 0) throw new Error(`Invalid budget count: ${count}`);
  await withE2eDatabase(async (client) => {
    await client.query(
      `with o as (select id from users where email = $1),
            c as (select k.id from categories k join o on k.owner_id = o.id
                   where k.kind = 'expense' and k.parent_id is null limit 1),
            b as (insert into budgets (owner_id, currency)
                  select o.id, 'ARS' from o cross join generate_series(1, $2::int)
                  returning id, owner_id),
            v as (insert into budget_versions (budget_id, owner_id, effective_from, name, amount)
                  select b.id, b.owner_id, date_trunc('month', now() at time zone $3)::date,
                         'Seed ' || left(b.id::text, 8), 100000
                    from b
                  returning id, owner_id),
            vc as (insert into budget_version_categories (version_id, owner_id, category_id)
                   select v.id, v.owner_id, c.id from v cross join c
                   returning 1)
       insert into budget_version_thresholds (version_id, owner_id, percent)
       select v.id, v.owner_id, 80 from v`,
      [email, count, TIME_ZONE],
    );
    const { rows } = await client.query(
      `select count(*)::int as n from budgets b join users u on u.id = b.owner_id
        where u.email = $1`,
      [email],
    );
    if (Number(rows[0]?.n ?? 0) < count) throw new Error(`Seeded fewer than ${count} budgets`);
  });
}

/** Moves every budget of `email` back `months` months, so earlier months have budgets to show. */
export async function backdateBudgets(email: string, months: number): Promise<void> {
  if (!Number.isInteger(months) || months <= 0) throw new Error(`Invalid month count: ${months}`);
  const result = await withE2eDatabase((client) =>
    client.query(
      `update budget_versions v
          set effective_from = (v.effective_from - make_interval(months => $2))::date
         from users u
        where u.id = v.owner_id and u.email = $1
       returning v.id`,
      [email, months],
    ),
  );
  if (result.rows.length === 0) throw new Error(`No budget stored for ${email}`);
}

/** Stores a budget alert notice for `email` as the worker would, for the first day of a month. */
export async function seedBudgetAlertNotice(
  email: string,
  firstOfMonth: string,
  text: string,
): Promise<void> {
  await withE2eDatabase((client) =>
    client.query(
      `insert into notices (owner_id, kind, payment_id, due_date, text)
       select id, 'budget_alert', gen_random_uuid(), $2::date, $3 from users where email = $1`,
      [email, firstOfMonth, text],
    ),
  );
}
