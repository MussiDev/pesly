import { fireEvent, within } from '@testing-library/react';

/** The accessible names of the row toggles, in both catalogs ("Acciones de …", "Actions for …"). */
const ROW_TOGGLE = /^(Acciones de|Actions for) /;

/**
 * Opens the actions of every collapsed movement or group expense row in `scope` (the whole page by
 * default) and returns the scope, so a query can follow: `within(openRows()).getByRole(...)`.
 */
export function openRows(scope: HTMLElement = document.body): HTMLElement {
  for (const toggle of within(scope).queryAllByRole('button', { name: ROW_TOGGLE })) {
    if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  }
  return scope;
}
