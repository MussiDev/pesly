import { screen, within } from '@testing-library/react';
import es from '../../messages/es.json';

type MovementTypeName = 'expense' | 'income' | 'transfer' | 'exchange';

/** The button of the segmented type control, in Spanish unless another catalog is given. */
export function typeButton(
  type: MovementTypeName,
  catalog: { movements: { fields: { type: string }; types: Record<string, string> } } = es,
): HTMLElement {
  return within(screen.getByRole('group', { name: catalog.movements.fields.type })).getByRole(
    'button',
    { name: catalog.movements.types[type] },
  );
}
