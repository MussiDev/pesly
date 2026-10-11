// @vitest-environment happy-dom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeleteConfirm } from '../src/features/groups/edit/components/delete-confirm';
import { FailedChangePanel } from '../src/features/groups/edit/components/failed-change-panel';
import { RowActions } from '../src/features/groups/edit/components/row-actions';
import { SyncMarker } from '../src/features/groups/edit/components/sync-marker';
import { canRetry, rejectionMessagePath } from '../src/features/groups/edit/rejection';
import { CATALOGS, renderApp } from './support/render-app';

function leaves(value: unknown, prefix = ''): [string, unknown][] {
  if (value === null || typeof value !== 'object') return [[prefix, value]];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('rejection', () => {
  it('maps a stored code to its error message and anything unknown to the generic one', () => {
    expect(rejectionMessagePath('GROUP_RECORD_EDIT_FORBIDDEN')).toBe(
      'errors.groupRecordEditForbidden',
    );
    expect(rejectionMessagePath('SOMETHING_ELSE')).toBe('errors.unexpected');
  });

  it.each([
    'GROUP_RECORD_FORMER_MEMBER',
    'GROUP_SETTLEMENT_CONSOLIDATED',
    'NOT_FOUND',
    'VALIDATION_FAILED',
    'GROUP_EXPENSE_CATEGORY_INVALID',
    'GROUP_SPLIT_PERCENTAGE_INVALID',
    'GROUP_SPLIT_AMOUNT_MISMATCH',
    'GROUP_SPLIT_MEMBER_INVALID',
    'GROUP_SETTLEMENT_MEMBER_INVALID',
  ])('%s cannot be fixed by retrying', (code) => {
    expect(canRetry(code)).toBe(false);
  });

  it.each(['GROUP_RECORD_EDIT_FORBIDDEN', 'INTERNAL', 'NETWORK', 'UNKNOWN_CODE'])(
    '%s offers retry',
    (code) => {
      expect(canRetry(code)).toBe(true);
    },
  );
});

describe('SyncMarker', () => {
  it.each(['pending', 'failed', 'conflict'] as const)(
    'carries %s as text, not colour alone',
    (state) => {
      renderApp(<SyncMarker state={state} />);
      const copy = CATALOGS.es.groups.edit.common.sync;
      expect(screen.getByText(copy[state])).toBeTruthy();
    },
  );

  it('renders nothing for a synced record', () => {
    const { container } = renderApp(<SyncMarker state="synced" />);
    expect(container.textContent).toBe('');
  });
});

describe('RowActions', () => {
  const copy = CATALOGS.es.groups.edit.common.actions;

  it('shows edit and delete when allowed', async () => {
    const onDelete = vi.fn();
    renderApp(
      <RowActions allowed consolidated={false} editHref="/groups/g/x" onDelete={onDelete} />,
    );
    expect(screen.getByRole('link', { name: copy.edit }).getAttribute('href')).toContain(
      '/groups/g/x',
    );
    await userEvent.click(screen.getByRole('button', { name: copy.delete }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('shows delete only for a consolidated record', () => {
    renderApp(<RowActions allowed consolidated editHref="/x" onDelete={vi.fn()} />);
    expect(screen.queryByRole('link', { name: copy.edit })).toBeNull();
    expect(screen.getByRole('button', { name: copy.delete })).toBeTruthy();
  });

  it('shows nothing when not allowed', () => {
    const { container } = renderApp(
      <RowActions allowed={false} consolidated={false} editHref="/x" onDelete={vi.fn()} />,
    );
    expect(container.textContent).toBe('');
  });
});

describe('DeleteConfirm', () => {
  const copy = CATALOGS.es.groups.edit.common.deleteConfirm;

  it('confirms and cancels through its two buttons', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderApp(<DeleteConfirm pending={false} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText(copy.title)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: copy.cancel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: copy.confirm }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables the buttons while pending', () => {
    renderApp(<DeleteConfirm pending onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: copy.working })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: copy.cancel })).toHaveProperty('disabled', true);
  });
});

describe('FailedChangePanel', () => {
  const actions = CATALOGS.es.groups.edit.common.actions;

  it('shows the reason with retry and discard for a retryable refusal', async () => {
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    renderApp(
      <FailedChangePanel
        code="GROUP_RECORD_EDIT_FORBIDDEN"
        onRetry={onRetry}
        onDiscard={onDiscard}
      />,
    );
    expect(screen.getByText(CATALOGS.es.errors.groupRecordEditForbidden)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: actions.retry }));
    await userEvent.click(screen.getByRole('button', { name: actions.discard }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('offers only discard, with the reason, when retrying cannot fix it', () => {
    renderApp(
      <FailedChangePanel code="GROUP_RECORD_FORMER_MEMBER" onRetry={vi.fn()} onDiscard={vi.fn()} />,
    );
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(CATALOGS.es.errors.groupRecordFormerMember)).toBeTruthy();
    expect(screen.queryByRole('button', { name: actions.retry })).toBeNull();
    expect(screen.getByRole('button', { name: actions.discard })).toBeTruthy();
  });
});

describe('groups.edit.common catalogs', () => {
  it('has the same non-empty keys in Spanish and English', () => {
    const es = leaves(CATALOGS.es.groups.edit.common);
    const en = leaves(CATALOGS.en.groups.edit.common);
    expect(es.length).toBeGreaterThan(0);
    expect(en.map(([key]) => key).sort()).toEqual(es.map(([key]) => key).sort());
    for (const [, text] of [...es, ...en]) {
      expect(typeof text === 'string' && text.trim().length > 0).toBe(true);
    }
  });
});
