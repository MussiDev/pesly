// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SyncStatus } from '../src/features/shell/components/sync-status';
import { renderApp } from './support/render-app';

describe('SyncStatus', () => {
  it('says how many changes wait to be synced (AC-03)', () => {
    renderApp(<SyncStatus pending={3} failed={0} />);

    expect(screen.getByRole('status').textContent).toBe('3 cambios esperando sincronizarse');
  });

  it('uses the singular for one change, in English too (AC-03)', () => {
    renderApp(<SyncStatus pending={1} failed={0} />, { locale: 'en' });

    expect(screen.getByRole('status').textContent).toBe('1 change waiting to sync');
  });

  it('shows the failed changes apart, as a link to the movement list (AC-05)', () => {
    renderApp(<SyncStatus pending={0} failed={2} />);

    const link = screen.getByRole('link', { name: '2 cambios no se sincronizaron' });
    expect(link.getAttribute('href')).toBe('/es/movements');
  });

  it('renders nothing when nothing waits and nothing failed (AC-03)', () => {
    renderApp(<SyncStatus pending={0} failed={0} />);

    expect(screen.queryByRole('status')).toBeNull();
  });
});
