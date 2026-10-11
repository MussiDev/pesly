// @vitest-environment happy-dom
import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../src/components/theme-provider';
import { SyncStatus } from '../src/features/shell/components/sync-status';
import { AuthenticatedShellContainer } from '../src/features/shell/containers/authenticated-shell-container';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { notifyQueueChanged } from '../src/lib/sync/sync-events';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const readGroupQueueCounts = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/sync/group-queue-counts', () => ({ readGroupQueueCounts }));

const { en, es } = CATALOGS;

describe('SyncStatus group lines (AC-22)', () => {
  it('shows waiting, failed and conflict group changes apart from the movement counts', () => {
    renderApp(
      <SyncStatus pending={2} failed={1} groupWaiting={3} groupFailed={4} groupConflict={5} />,
      { locale: 'en' },
    );

    const text = screen.getByRole('status').textContent;
    expect(text).toContain('2 changes waiting to sync');
    expect(text).toContain('1 change failed to sync');
    expect(screen.getByText('3 group changes waiting to sync')).toBeDefined();
    expect(screen.getByText('4 group changes failed to sync')).toBeDefined();
    expect(screen.getByText('5 group changes in conflict')).toBeDefined();
  });

  it('is unchanged with only movement counts and renders nothing with all zero', () => {
    const { unmount } = renderApp(<SyncStatus pending={3} failed={0} />);
    expect(screen.getByRole('status').textContent).toBe('3 cambios esperando sincronizarse');
    unmount();

    renderApp(
      <SyncStatus pending={0} failed={0} groupWaiting={0} groupFailed={0} groupConflict={0} />,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('links the group lines to the groups list', () => {
    renderApp(
      <SyncStatus pending={0} failed={0} groupWaiting={1} groupFailed={1} groupConflict={1} />,
      {
        locale: 'en',
      },
    );

    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.getAttribute('href')).toBe('/en/groups');
  });

  it('has the app.sync group keys in both catalogs', () => {
    for (const catalog of [en, es]) {
      for (const key of ['groupWaiting', 'groupFailed', 'groupConflict'] as const) {
        expect(catalog.app.sync[key].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('AuthenticatedShellContainer group counts (AC-22)', () => {
  beforeEach(() => {
    readGroupQueueCounts.mockReset();
    readGroupQueueCounts.mockResolvedValue({ pending: 0, failed: 0, conflict: 0 });
    stubApi({
      'GET /auth/session': {
        status: 200,
        body: {
          user: {
            id: 'u1',
            email: 'ana@example.com',
            emailVerified: true,
            language: 'es',
            timeZone: 'America/Argentina/Buenos_Aires',
          },
        },
      },
    });
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  function renderShell() {
    return renderApp(
      <ThemeProvider>
        <AuthenticatedShellContainer>
          <p>private content</p>
        </AuthenticatedShellContainer>
      </ThemeProvider>,
    );
  }

  it('updates the group counts when the queue changes', async () => {
    writeSessionPointer({ userId: 'u1', emailVerified: true });
    renderShell();
    await screen.findByText('private content');
    expect(screen.queryByText('2 cambios de grupo esperando sincronizarse')).toBeNull();

    readGroupQueueCounts.mockResolvedValue({ pending: 2, failed: 0, conflict: 0 });
    act(() => {
      notifyQueueChanged();
    });

    expect(await screen.findByText('2 cambios de grupo esperando sincronizarse')).toBeDefined();
    expect(readGroupQueueCounts).toHaveBeenCalledWith('u1');
  });

  it('asks for no user when there is no session pointer', async () => {
    renderShell();
    await screen.findByText('private content');

    await waitFor(() => {
      expect(readGroupQueueCounts).toHaveBeenCalled();
    });
    expect(readGroupQueueCounts.mock.calls.every(([id]) => id === 'u1' || id === undefined)).toBe(
      true,
    );
    expect(screen.queryByText(/cambios de grupo/)).toBeNull();
  });
});
