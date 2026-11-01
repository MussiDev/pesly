import { DEFAULT_CATEGORIES } from '@pesly/shared';
import { expect, type Page } from '@playwright/test';

/** Presses one button of the segmented movement-type control; `groupName` is the field's label. */
export async function chooseMovementType(
  page: Page,
  groupName: string,
  typeLabel: string,
): Promise<void> {
  await page
    .getByRole('group', { name: groupName })
    .getByRole('button', { name: typeLabel, exact: true })
    .click();
}

/** The parent's name of a default subcategory named `label` in either language, if it is one. */
function defaultParentOf(label: string): string | undefined {
  const child = DEFAULT_CATEGORIES.find(
    (entry) => entry.parentKey !== null && (entry.names.es === label || entry.names.en === label),
  );
  const parent = DEFAULT_CATEGORIES.find((entry) => entry.key === child?.parentKey);
  if (child === undefined || parent === undefined) return undefined;
  return child.names.es === label ? parent.names.es : parent.names.en;
}

/**
 * Picks a category of the movement form by pressing its label; the radio is visually hidden. A
 * subcategory only shows once its parent's tile is picked, so a default one opens its parent first.
 */
export async function chooseCategory(
  page: Page,
  groupName: string,
  categoryLabel: string,
): Promise<void> {
  const group = page.getByRole('group', { name: groupName });
  const option = group.getByText(categoryLabel, { exact: true });
  const parent = defaultParentOf(categoryLabel);
  if (parent !== undefined && !(await option.isVisible())) {
    await group.getByText(parent, { exact: true }).first().click();
  }
  await option.click();
  await expect(group.getByRole('radio', { name: categoryLabel, exact: true })).toBeChecked();
}

/**
 * Picks a category of an icon grid by its id, as a select's `{ value }` used to. The radio may be
 * a subcategory that is only shown once its parent is open, so it is clicked through the DOM.
 */
export async function chooseCategoryById(
  scope: Page,
  groupName: string,
  categoryId: string,
): Promise<void> {
  const radio = scope
    .getByRole('group', { name: groupName, exact: true })
    .locator(`input[type="radio"][value="${categoryId}"]`);
  await radio.evaluate((element) => {
    (element as HTMLInputElement).click();
  });
  await expect(radio).toBeChecked();
}

/** Picks the first tile of a category grid, as a select's `{ index: 1 }` used to. */
export async function chooseFirstCategory(scope: Page, groupName: string): Promise<void> {
  const group = scope.getByRole('group', { name: groupName, exact: true });
  const first = group.getByRole('radio').first();
  await first.evaluate((element) => {
    (element as HTMLInputElement).click();
  });
  await expect(first).toBeChecked();
}
