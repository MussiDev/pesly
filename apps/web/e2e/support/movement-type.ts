import type { Page } from '@playwright/test';

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
