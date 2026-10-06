// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSignOut } from '../src/features/shell/use-sign-out';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import type * as SyncQueue from '../src/lib/sync/sync-queue';
import { renderApp, stubApi } from './support/render-app';

/** The requests made so far, read by the mocked `cancelSyncRetry` at the moment it runs. */
let liveCalls: { path: string }[] = [];
const signOutRequestsAtCancel: number[] = [];

vi.mock('../src/lib/sync/sync-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof SyncQueue>();
  return {
    ...actual,
    cancelSyncRetry: () => {
      signOutRequestsAtCancel.push(
        liveCalls.filter((call) => call.path === '/auth/sign-out').length,
      );
    },
  };
});

function SignOutProbe() {
  const { requestSignOut } = useSignOut();
  return (
    <button
      type="button"
      onClick={() => {
        void requestSignOut();
      }}
    >
      sign out
    </button>
  );
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  signOutRequestsAtCancel.length = 0;
  writeSessionPointer({ userId: 'u1', emailVerified: true });
});

describe('sign out order (D6)', () => {
  it('cancels the scheduled sync retry before asking the API to end the session (AC-04)', async () => {
    const { calls } = stubApi({ 'POST /auth/sign-out': { status: 204 } });
    liveCalls = calls;
    const { router } = renderApp(<SignOutProbe />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'sign out' }));
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });

    expect(signOutRequestsAtCancel).toEqual([0]);
    expect(calls.filter((call) => call.path === '/auth/sign-out')).toHaveLength(1);
  });
});
