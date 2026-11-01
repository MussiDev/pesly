import { expect, type Page } from '@playwright/test';

/**
 * Picks an option of a segmented field (a radio group shown as one row) by tapping its visible
 * text, as a person does, and checks that its radio is now the checked one.
 */
export async function chooseSegment(
  page: Page,
  groupLabel: string,
  optionLabel: string,
): Promise<void> {
  const group = page.getByRole('radiogroup', { name: groupLabel, exact: true });
  await group.getByText(optionLabel, { exact: true }).click();
  await expect(group.getByRole('radio', { name: optionLabel, exact: true })).toBeChecked();
}

/**
 * Picks an option of a segmented field by its value (the code a select option carried), for
 * flows that only know the value. Clicked through the DOM: the radio itself is visually hidden.
 */
export async function chooseSegmentValue(
  page: Page,
  groupLabel: string,
  value: string,
): Promise<void> {
  const radio = page
    .getByRole('radiogroup', { name: groupLabel, exact: true })
    .locator(`input[type="radio"][value="${value}"]`);
  await radio.evaluate((element) => {
    (element as HTMLInputElement).click();
  });
  await expect(radio).toBeChecked();
}
