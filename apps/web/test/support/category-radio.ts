/** The chip (radio button) of a category in the movement form, found by the category's id. */
export function categoryRadio(id: string): HTMLElement {
  const radio = document.querySelector<HTMLElement>(`input[name="categoryId"][value="${id}"]`);
  if (radio === null) throw new Error(`No category chip for ${id}`);
  return radio;
}

import { screen, within } from '@testing-library/react';
import es from '../../messages/es.json';

/** The group of category chips of the movement form, in Spanish unless another catalog is given. */
export function categoryGroup(
  catalog: { movements: { fields: { category: string } } } = es,
): HTMLElement {
  return screen.getByRole('group', { name: catalog.movements.fields.category });
}

/** The id of the category that is picked, or `''` when none is. */
export function pickedCategory(): string {
  const radios = within(categoryGroup()).getAllByRole<HTMLInputElement>('radio');
  return radios.find((radio) => radio.checked)?.value ?? '';
}
