// @vitest-environment happy-dom
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MovementRow } from '../src/features/movements/components/movement-row';
import { renderApp, CATALOGS } from './support/render-app';
import { openRows } from './support/open-rows';
import { uuid } from './support/category-fixtures';

const { es, en } = CATALOGS;

const MOVEMENT = {
  id: uuid(500),
  type: 'expense' as const,
  accountId: uuid(1),
  categoryId: uuid(11),
  destinationAccountId: null,
  amount: '150050',
  destinationAmount: null,
  occurredAt: '2026-10-02T15:30:00.000Z',
  note: null,
  rate: '12505000',
  rateSource: 'automatic' as const,
  rateType: 'blue' as const,
  createdAt: '2026-10-02T15:31:00.000Z',
  tags: [],
};

const ACTIONS = {
  pending: false,
  confirmingDelete: false,
  onAskDelete: vi.fn(),
  onConfirmDelete: vi.fn(),
  onCancelDelete: vi.fn(),
};

function renderRow(
  props: Partial<Parameters<typeof MovementRow>[0]> = {},
  locale: 'es' | 'en' = 'es',
) {
  return renderApp(
    <ul>
      <MovementRow
        movement={MOVEMENT}
        accountName="Caja"
        currency="ARS"
        categoryName="Comida"
        destinationAccountName={undefined}
        destinationCurrency={undefined}
        timeZone="UTC"
        actions={ACTIONS}
        {...props}
      />
    </ul>,
    { locale },
  );
}

describe('MovementRow: send to group (DISC-001-05i)', () => {
  it('shows the send link to /movements/send?id= with the title in its accessible name, in view without opening the row (AC-01, NFR-08)', () => {
    renderRow({ groupAction: { kind: 'send' } });

    // Before the row is opened.
    const link = screen.getByRole('link', {
      name: `${es.movements.list.actions.sendToGroup} Comida`,
    });
    expect(link.getAttribute('href')).toContain(`/movements/send?id=${MOVEMENT.id}`);
    expect(link.getAttribute('title')).toBe(es.movements.list.actions.sendToGroup);
    const edit = within(openRows()).getByRole('link', {
      name: `${es.movements.list.actions.edit} Comida`,
    });
    expect(edit).toBeDefined();
    expect(
      screen.getByRole('button', { name: `${es.movements.list.actions.delete} Comida` }),
    ).toBeDefined();
    // Placed before the edit link.
    expect(link.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no send link without a groupAction, and none while the delete confirmation is open or for a failed delete (invalid states, AC-02)', () => {
    const { unmount } = renderRow();
    expect(screen.queryByRole('link', { name: /Enviar a un grupo/ })).toBeNull();
    unmount();

    const confirming = renderRow({
      groupAction: { kind: 'send' },
      actions: { ...ACTIONS, confirmingDelete: true },
    });
    expect(screen.queryByRole('link', { name: /Enviar a un grupo/ })).toBeNull();
    confirming.unmount();

    renderRow({
      groupAction: { kind: 'send' },
      syncState: 'failed',
      failure: { operation: 'delete', code: 'NOT_FOUND' },
    });
    expect(screen.queryByRole('link', { name: /Enviar a un grupo/ })).toBeNull();
  });

  it('shows "In group {name}" for a linked row, and "In a group" without a name, in both languages (AC-05)', () => {
    const { unmount } = renderRow({ groupAction: { kind: 'linked', groupName: 'Depto' } });
    expect(screen.getByText(es.movements.list.inGroup.replace('{name}', 'Depto'))).toBeDefined();
    expect(screen.queryByRole('link', { name: /Enviar a un grupo/ })).toBeNull();
    unmount();

    const unknown = renderRow({ groupAction: { kind: 'linked', groupName: undefined } }, 'en');
    expect(screen.getByText(en.movements.list.inGroupUnknown)).toBeDefined();
    unknown.unmount();
  });

  it('marks a highlighted row with aria-current and the visible-to-screen-readers text (AC-42)', () => {
    renderRow({ highlighted: true });

    const row = screen.getByRole('listitem');
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(row.getAttribute('tabindex')).toBe('-1');
    expect(within(row).getByText(es.movements.list.highlighted)).toBeDefined();
  });

  it('does not mark a row that is not highlighted', () => {
    renderRow();

    const row = screen.getByRole('listitem');
    expect(row.getAttribute('aria-current')).toBeNull();
    expect(screen.queryByText(es.movements.list.highlighted)).toBeNull();
  });

  it('has the four new keys in both catalogs, none empty (NFR-04)', () => {
    for (const catalog of [es, en]) {
      const list = catalog.movements.list;
      for (const value of [
        list.actions.sendToGroup,
        list.inGroup,
        list.inGroupUnknown,
        list.highlighted,
      ]) {
        expect(value.trim()).not.toBe('');
      }
    }
  });
});

describe('MovementRow: compact row with actions on a tap', () => {
  it('keeps the actions closed until the row is tapped, then opens and closes them', () => {
    renderRow();

    const toggle = screen.getByRole('button', { name: 'Acciones de Comida' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Eliminar Comida' })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Eliminar Comida' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Editar Comida' })).toBeDefined();

    fireEvent.click(toggle);
    expect(screen.queryByRole('button', { name: 'Eliminar Comida' })).toBeNull();
  });

  it('shows an open delete confirmation even when closed, and closing the row cancels it', () => {
    const onCancelDelete = vi.fn();
    renderRow({ actions: { ...ACTIONS, confirmingDelete: true, onCancelDelete } });

    expect(screen.getByText(es.movements.list.actions.confirmDelete)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Acciones de Comida' }));

    expect(onCancelDelete).toHaveBeenCalledOnce();
  });

  it('shows tags, the group and the note in the row itself, without opening it', () => {
    renderRow({
      movement: { ...MOVEMENT, note: 'Compra semanal', tags: ['super', 'familia'] },
      groupAction: { kind: 'linked', groupName: 'Casa' },
    });

    const tags = screen.getByRole('group', { name: es.movements.list.tags });
    expect(within(tags).getByText('super')).toBeDefined();
    expect(within(tags).getByText('familia')).toBeDefined();
    expect(screen.getByText('En el grupo Casa')).toBeDefined();
    expect(screen.getByText('Compra semanal')).toBeDefined();
  });

  it('renders read-only, with no toggle, when the row offers no actions', () => {
    renderRow({ actions: undefined });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Comida')).toBeDefined();
  });
});
