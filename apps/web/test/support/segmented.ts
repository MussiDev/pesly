import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** A segmented field: a radio group named by its visible label. */
export function segment(label: string): HTMLElement {
  return screen.getByRole('radiogroup', { name: label });
}

/** One option of a segmented field, found by its value (the code a select option carried). */
export function segmentOption(label: string, value: string): HTMLInputElement {
  const radio = within(segment(label))
    .getAllByRole<HTMLInputElement>('radio')
    .find((option) => option.value === value);
  if (radio === undefined) throw new Error(`No option ${value} in ${label}`);
  return radio;
}

/** What a segmented field holds now: the checked option's value, or '' when none is checked. */
export function segmentValue(label: string): string {
  return (
    within(segment(label))
      .getAllByRole<HTMLInputElement>('radio')
      .find((option) => option.checked)?.value ?? ''
  );
}

/** The values a segmented field offers, in order. */
export function segmentValues(label: string): string[] {
  return within(segment(label))
    .getAllByRole<HTMLInputElement>('radio')
    .map((option) => option.value);
}

/** Taps an option, as `selectOptions` did on the select it replaces. */
export async function pickSegment(label: string, value: string): Promise<void> {
  await userEvent.click(segmentOption(label, value));
}

/** The radio group named `label`, or null when that field is a select (or not there). */
function maybeSegment(label: string): HTMLElement | null {
  return screen.queryByRole('radiogroup', { name: label });
}

/** The value of a select or a segmented field, whichever `label` names. */
export function fieldValue(label: string): string {
  return maybeSegment(label) === null
    ? screen.getByLabelText<HTMLSelectElement>(label).value
    : segmentValue(label);
}

/** The values a select or a segmented field offers. */
export function fieldOptions(label: string): (string | null)[] {
  return maybeSegment(label) === null
    ? within(screen.getByLabelText(label))
        .getAllByRole('option')
        .map((option) => option.getAttribute('value'))
    : segmentValues(label);
}

/** Chooses `value` in a select or a segmented field, whichever `label` names. */
export async function chooseField(label: string, value: string): Promise<void> {
  if (maybeSegment(label) === null) {
    await userEvent.selectOptions(screen.getByLabelText(label), value);
  } else {
    await pickSegment(label, value);
  }
}

/** Waits for a segmented field to appear (a form that loads first), then returns it. */
export function findSegment(label: string): Promise<HTMLElement> {
  return screen.findByRole('radiogroup', { name: label });
}
