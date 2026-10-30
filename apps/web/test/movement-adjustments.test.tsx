// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MovementAvatar } from '../src/features/movements/components/movement-avatar';
import { MovementRow } from '../src/features/movements/components/movement-row';
import { parseInitialType } from '../src/features/movements/initial-type';
import { renderApp, CATALOGS } from './support/render-app';
import { openRows } from './support/open-rows';
import { uuid } from './support/category-fixtures';

const { es, en } = CATALOGS;

const ADJUSTMENT = {
  id: uuid(900),
  type: 'adjustment' as const,
  accountId: uuid(1),
  categoryId: null,
  destinationAccountId: null,
  amount: '-50000',
  destinationAmount: null,
  occurredAt: '2026-10-02T15:30:00.000Z',
  note: 'Recount',
  rate: null,
  rateSource: null,
  rateType: null,
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
        movement={ADJUSTMENT}
        accountName="Caja"
        currency="ARS"
        categoryName={undefined}
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

describe('MovementRow: balance adjustment (FEAT-012)', () => {
  it('shows the Adjustment label and the signed amount, in both languages (AC-06)', () => {
    const { unmount } = renderRow();
    const row = screen.getByRole('listitem');
    expect(within(row).getAllByText(es.movements.types.adjustment).length).toBeGreaterThan(0);
    expect(within(row).queryByText(es.movements.list.unknownCategory)).toBeNull();
    const amount = row.querySelector('[data-slot="amount"]');
    expect(amount?.getAttribute('data-kind')).toBe('expense');
    expect(amount?.textContent).toContain('−');
    expect(amount?.textContent).toContain('500,00');
    unmount();

    renderRow({ movement: { ...ADJUSTMENT, amount: '50000' } }, 'en');
    const enRow = screen.getByRole('listitem');
    expect(within(enRow).getAllByText(en.movements.types.adjustment).length).toBeGreaterThan(0);
    const enAmount = enRow.querySelector('[data-slot="amount"]');
    expect(enAmount?.getAttribute('data-kind')).toBe('income');
    expect(enAmount?.textContent).toContain('+');
  });

  it('has no edit link and no send-to-group link, but keeps delete (AC-07)', () => {
    renderRow({ groupAction: { kind: 'send' } });

    expect(screen.queryByRole('link')).toBeNull();
    expect(
      within(openRows()).getByRole('button', {
        name: `${es.movements.list.actions.delete} ${es.movements.types.adjustment}`,
      }),
    ).toBeDefined();
  });

  it('asks for a confirmation that names the effect on later balances (AC-08)', () => {
    renderRow({ actions: { ...ACTIONS, confirmingDelete: true } });

    expect(screen.getByText(es.movements.list.actions.confirmDeleteAdjustment)).toBeDefined();
    expect(screen.queryByText(es.movements.list.actions.confirmDelete)).toBeNull();
    expect(
      screen.getByRole('button', { name: es.movements.list.actions.confirmDeleteYes }),
    ).toBeDefined();
  });

  it('error: a regular movement keeps the usual delete confirmation', () => {
    renderRow({
      movement: { ...ADJUSTMENT, type: 'expense', amount: '1000', categoryId: uuid(11) },
      categoryName: 'Comida',
      actions: { ...ACTIONS, confirmingDelete: true },
    });

    expect(screen.getByText(es.movements.list.actions.confirmDelete)).toBeDefined();
  });

  it('error: a malformed signed amount degrades to a dash', () => {
    renderRow({ movement: { ...ADJUSTMENT, amount: 'abc' } });

    expect(screen.getByText('—')).toBeDefined();
  });

  it('renders an avatar for the adjustment that is neither a logo nor a category icon', () => {
    const { container } = renderApp(
      <MovementAvatar type="adjustment" note="Spotify" categoryIcon="banknote" categoryColor="x" />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-icon]')).toBeNull();
    expect(container.querySelector('[data-slot="avatar"] svg')).not.toBeNull();
  });
});

describe('parseInitialType: adjustment (FEAT-012)', () => {
  it('error: ?type=adjustment opens on an expense, never on an adjustment', () => {
    expect(parseInitialType('adjustment')).toBe('expense');
  });
});
