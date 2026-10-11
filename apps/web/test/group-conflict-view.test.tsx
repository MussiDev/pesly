// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  GroupConflictView,
  type ConflictSide,
} from '../src/features/groups/components/group-conflict-view';
import { CATALOGS, renderApp } from './support/render-app';

const { es, en } = CATALOGS;
const copy = es.groupConflict;

const MINE: ConflictSide = {
  amount: '120,00 ARS',
  occurredAt: '2 oct 2026, 12:30',
  category: 'Comida',
  description: 'Cena',
  split: {
    mode: 'equal',
    rows: [
      { member: 'Ana', value: '' },
      { member: 'Beto', value: '' },
    ],
  },
};

const SERVER: ConflictSide = {
  ...MINE,
  amount: '150,00 ARS',
  description: 'Cena con postre',
};

function renderView(overrides: Partial<Parameters<typeof GroupConflictView>[0]> = {}) {
  const onKeepMine = vi.fn();
  const onKeepServer = vi.fn();
  renderApp(
    <GroupConflictView
      kind="expense"
      mine={MINE}
      server={SERVER}
      busy={false}
      failed={false}
      onKeepMine={onKeepMine}
      onKeepServer={onKeepServer}
      {...overrides}
    />,
  );
  return { onKeepMine, onKeepServer };
}

const column = (name: string): HTMLElement => screen.getByRole('region', { name });

describe('GroupConflictView (DISC-001-04e Block 8)', () => {
  it('shows both versions side by side with both buttons', () => {
    renderView();

    const mine = within(column(copy.mine));
    const server = within(column(copy.server));
    expect(mine.getByText('120,00 ARS')).toBeTruthy();
    expect(server.getByText('150,00 ARS')).toBeTruthy();
    expect(mine.getByText('Cena')).toBeTruthy();
    expect(server.getByText('Cena con postre')).toBeTruthy();
    expect(mine.getByText('Comida')).toBeTruthy();
    expect(mine.getByText(/Ana/)).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.keepMine })).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.keepServer })).toBeTruthy();
  });

  it('highlights only the fields that differ, in both columns', () => {
    renderView();

    const mine = within(column(copy.mine));
    const server = within(column(copy.server));
    expect(mine.getByText('120,00 ARS').closest('[data-differs]')).not.toBeNull();
    expect(server.getByText('Cena con postre').closest('[data-differs]')).not.toBeNull();
    expect(mine.getByText('Comida').closest('[data-differs]')).toBeNull();
    expect(mine.getByText('2 oct 2026, 12:30').closest('[data-differs]')).toBeNull();
  });

  it('marks a difference for assistive technology, not only by color', () => {
    renderView();

    expect(within(column(copy.mine)).getAllByText(copy.differs)).toHaveLength(2);
  });

  it('shows only amount and date for a settlement', () => {
    renderView({
      kind: 'settlement',
      mine: { amount: '25,00 ARS', occurredAt: '3 oct 2026, 07:00' },
      server: { amount: '30,00 ARS', occurredAt: '3 oct 2026, 07:00' },
    });

    const mine = within(column(copy.mine));
    expect(mine.getByText('25,00 ARS')).toBeTruthy();
    expect(mine.queryByText(copy.fields.category)).toBeNull();
    expect(mine.queryByText(copy.fields.split)).toBeNull();
  });

  it('shows a local deletion in the mine column', () => {
    renderView({ mine: { deleted: true, amount: '120,00 ARS', occurredAt: 'x' } });

    expect(within(column(copy.mine)).getByText(copy.deleted)).toBeTruthy();
  });

  it('calls each handler from its own button', async () => {
    const { onKeepMine, onKeepServer } = renderView();

    await userEvent.click(screen.getByRole('button', { name: copy.keepServer }));
    expect(onKeepServer).toHaveBeenCalledTimes(1);
    expect(onKeepMine).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: copy.keepMine }));
    expect(onKeepMine).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while busy', () => {
    renderView({ busy: true });

    expect(screen.getByRole('button', { name: copy.keepMine }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: copy.keepServer }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('shows an error and keeps both versions when the resolution failed', () => {
    renderView({ failed: true });

    expect(screen.getByRole('alert').textContent).toContain(copy.error);
    expect(within(column(copy.mine)).getByText('120,00 ARS')).toBeTruthy();
    expect(within(column(copy.server)).getByText('150,00 ARS')).toBeTruthy();
  });

  it('renders in English', () => {
    renderApp(
      <GroupConflictView
        kind="expense"
        mine={MINE}
        server={SERVER}
        busy={false}
        failed={false}
        onKeepMine={vi.fn()}
        onKeepServer={vi.fn()}
      />,
      { locale: 'en' },
    );

    expect(screen.getByRole('button', { name: en.groupConflict.keepMine })).toBeTruthy();
  });
});

describe('groupConflict catalog', () => {
  const flat = (value: unknown, prefix = ''): string[] =>
    typeof value === 'string'
      ? [prefix]
      : Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
          flat(child, prefix ? `${prefix}.${key}` : key),
        );

  it('has the same non-empty keys in Spanish and English', () => {
    expect(flat(es.groupConflict).length).toBeGreaterThan(10);
    expect(flat(es.groupConflict).sort()).toEqual(flat(en.groupConflict).sort());
  });
});
