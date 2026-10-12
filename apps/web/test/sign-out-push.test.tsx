// @vitest-environment happy-dom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSignOut } from '../src/features/shell/use-sign-out';
import { writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { renderApp, stubApi } from './support/render-app';

const push = vi.hoisted(() => ({
  readSubscription: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('../src/lib/push/push-client', () => push);

const SUBSCRIPTION = { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } };

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

async function signOut(routes: Parameters<typeof stubApi>[0]) {
  const { calls } = stubApi(routes);
  const { router } = renderApp(<SignOutProbe />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'sign out' }));
  await waitFor(() => {
    expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
  });
  return calls;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  writeSessionPointer({ userId: 'u1', emailVerified: true });
  push.readSubscription.mockReset();
  push.unsubscribe.mockReset();
  push.unsubscribe.mockResolvedValue(true);
});

describe('sign out removes the push subscription', () => {
  it('removes the server and browser subscription, before the session ends', async () => {
    push.readSubscription.mockResolvedValue(SUBSCRIPTION);
    const calls = await signOut({
      'POST /push/subscriptions/unsubscribe': { status: 204 },
      'POST /auth/sign-out': { status: 204 },
    });

    const paths = calls.map((call) => call.path);
    expect(paths).toContain('/push/subscriptions/unsubscribe');
    expect(paths.indexOf('/push/subscriptions/unsubscribe')).toBeLessThan(
      paths.indexOf('/auth/sign-out'),
    );
    expect(push.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('still signs out when removing the subscription fails', async () => {
    push.readSubscription.mockResolvedValue(SUBSCRIPTION);
    const calls = await signOut({
      'POST /push/subscriptions/unsubscribe': { status: 500, body: { code: 'INTERNAL' } },
      'POST /auth/sign-out': { status: 204 },
    });

    expect(calls.filter((call) => call.path === '/auth/sign-out')).toHaveLength(1);
  });

  it('still signs out when reading the subscription throws', async () => {
    push.readSubscription.mockRejectedValue(new Error('unsupported'));
    const calls = await signOut({ 'POST /auth/sign-out': { status: 204 } });

    expect(calls.filter((call) => call.path === '/auth/sign-out')).toHaveLength(1);
    expect(push.unsubscribe).not.toHaveBeenCalled();
  });

  it('does nothing when there is no subscription', async () => {
    push.readSubscription.mockResolvedValue(null);
    const calls = await signOut({ 'POST /auth/sign-out': { status: 204 } });

    expect(calls.map((call) => call.path)).toEqual(['/auth/sign-out']);
    expect(push.unsubscribe).not.toHaveBeenCalled();
  });
});
