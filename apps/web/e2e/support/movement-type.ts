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

/** Picks a category chip of the movement form by pressing its label; the radio is visually hidden. */
export async function chooseCategory(
  page: Page,
  groupName: string,
  categoryLabel: string,
): Promise<void> {
  const group = page.getByRole('group', { name: groupName });
  await group.getByText(categoryLabel, { exact: true }).click();
  await expect(group.getByRole('radio', { name: categoryLabel, exact: true })).toBeChecked();
}
