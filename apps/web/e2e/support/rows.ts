import { expect, type Locator, type Page } from '@playwright/test';
import { catalogs } from './catalogs';

/** The accessible names of the row toggles, in both catalogs ("Acciones de …", "Actions for …"). */
const ROW_TOGGLE = /^(Acciones de|Actions for) /;

/**
 * Opens the actions of the movement or group expense rows in `scope` (a row, or the page) that are
 * still closed: edit, delete and the other row actions only show once a row is tapped.
 */
export async function openRows(scope: Locator | Page): Promise<void> {
  // Right after a navigation the rows may not be painted yet; a scope without rows simply times out.
  await scope
    .getByRole('button', { name: ROW_TOGGLE })
    .first()
    .waitFor({ state: 'attached', timeout: 5000 })
    .catch(() => undefined);
  const toggles = scope.getByRole('button', { name: ROW_TOGGLE, expanded: false });
  for (let count = await toggles.count(); count > 0; count = await toggles.count()) {
    await toggles.first().click();
  }
}

/** Opens the "Members and settings" section of the open group page, where it is closed. */
export async function openGroupManagement(page: Page): Promise<void> {
  const details = page.locator('details', {
    has: page.getByText(catalogs.es.groups.detail.manageTitle, { exact: true }),
  });
  if ((await details.getAttribute('open')) === null) {
    await page.getByText(catalogs.es.groups.detail.manageTitle, { exact: true }).click();
  }
  await expect(details).toHaveAttribute('open', '');
}

/**
 * Opens the rows of `scope` until `check` passes: a row gets its actions once the device queue is
 * read, after the first paint, so a single pass may find no toggle yet.
 */
export async function openRowsUntil(
  scope: Locator | Page,
  check: () => Promise<void>,
): Promise<void> {
  await expect(async () => {
    await openRows(scope);
    await check();
  }).toPass();
}
