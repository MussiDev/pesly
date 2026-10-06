// @vitest-environment happy-dom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../src/components/theme-provider';
import { SignOutConfirmation } from '../src/features/shell/components/sign-out-confirmation';
import { AuthenticatedShellContainer } from '../src/features/shell/containers/authenticated-shell-container';
import { useSignOut } from '../src/features/shell/use-sign-out';
import { enqueueMovement, loadQueue, markRejected } from '../src/lib/local-store/queue';
import { readSessionPointer, writeSessionPointer } from '../src/lib/local-store/session-pointer';
import { openLocalStore } from '../src/lib/local-store/stores';
import { readWipeMarker } from '../src/lib/local-store/wipe-marker';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;

const USER = 'u1';
const ACCOUNT = '00000000-0000-4000-8000-000000000900';
const CATEGORY = '00000000-0000-4000-8000-000000000901';
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const SESSION = {
  status: 200,
  body: {
    user: {
      id: USER,
      email: 'ana@example.com',
      emailVerified: true,
      language: 'es',
      timeZone: 'America/Argentina/Buenos_Aires',
    },
  },
};

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

/** Queues `pending` changes and `failed` rejected ones for the user. */
async function seedQueue(pending: number, failed: number): Promise<void> {
  const store = await openLocalStore(USER);
  for (let n = 1; n <= pending + failed; n += 1) {
    await enqueueMovement(store, {
      id: id(n),
      type: 'expense',
      accountId: ACCOUNT,
      categoryId: CATEGORY,
      amount: '100',
      occurredAt: '2026-10-02T15:30:00.000Z',
      rate: { source: 'manual', value: '14000000' },
    });
  }
  for (let n = pending + 1; n <= pending + failed; n += 1) {
    await markRejected(store, id(n), 'ACCOUNT_ARCHIVED');
  }
  store.close();
}

async function queuedCount(): Promise<number> {
  const store = await openLocalStore(USER);
  const items = await loadQueue(store);
  store.close();
  return items.length;
}

async function databaseNames(): Promise<(string | undefined)[]> {
  return (await indexedDB.databases()).map((database) => database.name);
}

function renderShell(locale: 'es' | 'en' = 'es') {
  return renderApp(
    <ThemeProvider>
      <AuthenticatedShellContainer>
        <p>private content</p>
      </AuthenticatedShellContainer>
    </ThemeProvider>,
    { locale },
  );
}

/** The shell confirmed online; the queue cannot leave because every send fails on the network. */
function stubShellApi(signOut: Parameters<typeof stubApi>[0][string]) {
  return stubApi({
    'GET /auth/session': SESSION,
    'POST /movements': 'network-error',
    'POST /auth/sign-out': signOut,
  });
}

const signOutCalls = (calls: { method: string; path: string }[]): number =>
  calls.filter((call) => call.method === 'POST' && call.path === '/auth/sign-out').length;

/** The hook alone, for the cases that do not need the whole shell. */
function SignOutProbe() {
  const { confirming, requestSignOut } = useSignOut();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void requestSignOut();
        }}
      >
        sign out
      </button>
      <p data-testid="confirming">{confirming ?? ''}</p>
    </>
  );
}

async function clickSignOut(): Promise<void> {
  await screen.findByText('private content');
  await userEvent.setup().click(screen.getByRole('button', { name: es.auth.signOut.label }));
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
  writeSessionPointer({ userId: USER, emailVerified: true });
  setOnline(true);
});

afterEach(() => {
  setOnline(true);
});

describe('sign out with changes pending sync (AC-03, AC-04)', () => {
  it('with 2 pending and 1 failed change, shows the confirmation for 3 changes and calls no API (AC-03)', async () => {
    await seedQueue(2, 1);
    const { calls } = stubShellApi({ status: 204 });
    const { router } = renderShell();

    await clickSignOut();

    const dialog = await screen.findByRole('alertdialog', {
      name: es.auth.signOut.confirmTitle,
    });
    expect(dialog.textContent).toContain(
      '3 cambios todavía no se enviaron. Si cierras sesión ahora, se perderán.',
    );
    expect(signOutCalls(calls)).toBe(0);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('confirming signs out, deletes the database, clears the pointer and goes to sign-in (AC-04)', async () => {
    await seedQueue(2, 1);
    const { calls } = stubShellApi({ status: 204 });
    const { router } = renderShell();
    await clickSignOut();

    const dialog = await screen.findByRole('alertdialog');
    await userEvent
      .setup()
      .click(within(dialog).getByRole('button', { name: es.auth.signOut.confirm }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(signOutCalls(calls)).toBe(1);
    expect(readSessionPointer()).toBeNull();
    await waitFor(async () => {
      expect(await databaseNames()).not.toContain(`pesly-${USER}`);
    });
  });

  it('cancelling hides the confirmation and keeps the queue and the session (AC-03)', async () => {
    await seedQueue(2, 1);
    const { calls } = stubShellApi({ status: 204 });
    const { router } = renderShell();
    await clickSignOut();

    const dialog = await screen.findByRole('alertdialog');
    await userEvent
      .setup()
      .click(within(dialog).getByRole('button', { name: es.auth.signOut.cancel }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(signOutCalls(calls)).toBe(0);
    expect(router.replace).not.toHaveBeenCalled();
    expect(readSessionPointer()?.userId).toBe(USER);
    expect(await queuedCount()).toBe(3);
  });

  it('with an empty queue signs out at once, without the confirmation, and wipes the data (AC-04)', async () => {
    const store = await openLocalStore(USER);
    store.close();
    const { calls } = stubShellApi({ status: 204 });
    const { router } = renderShell();

    await clickSignOut();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(signOutCalls(calls)).toBe(1);
    expect(readSessionPointer()).toBeNull();
    await waitFor(async () => {
      expect(await databaseNames()).not.toContain(`pesly-${USER}`);
    });
  });

  it('error: when the API sign out fails, the error shows and the queue, copy and pointer are kept', async () => {
    await seedQueue(2, 1);
    stubShellApi('network-error');
    const { router } = renderShell();
    await clickSignOut();

    const dialog = await screen.findByRole('alertdialog');
    await userEvent
      .setup()
      .click(within(dialog).getByRole('button', { name: es.auth.signOut.confirm }));

    expect(await screen.findByText(es.errors.network)).toBeDefined();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
    expect(readSessionPointer()?.userId).toBe(USER);
    expect(readWipeMarker()).toEqual([]);
    expect(await databaseNames()).toContain(`pesly-${USER}`);
    expect(await queuedCount()).toBe(3);
    expect(
      screen.getByRole('button', { name: es.auth.signOut.label }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('error: a queue that cannot be read counts as zero and the sign out goes ahead without a warning', async () => {
    await seedQueue(2, 1);
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { calls } = stubShellApi({ status: 204 });
    const { router } = renderShell();

    await clickSignOut();

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(signOutCalls(calls)).toBe(1);
    // The wipe was still attempted: the marker finishes it on the next start.
    expect(readWipeMarker()).toEqual([USER]);
    expect(readSessionPointer()).toBeNull();
  });

  it('error: without a pointer the sign out completes and wipes nothing', async () => {
    await seedQueue(2, 1);
    // Blocked or cleared `localStorage`: the device knows no user, so there is nothing to wipe.
    localStorage.clear();
    const { calls } = stubApi({ 'POST /auth/sign-out': { status: 204 } });
    const { router } = renderApp(<SignOutProbe />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'sign out' }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(screen.getByTestId('confirming').textContent).toBe('');
    expect(signOutCalls(calls)).toBe(1);
    expect(readWipeMarker()).toEqual([]);
    expect(await databaseNames()).toContain(`pesly-${USER}`);
  });

  it('error: a wipe that answers pending still completes the sign out', async () => {
    const store = await openLocalStore(USER);
    store.close();
    const { router } = renderApp(<SignOutProbe />);
    stubApi({ 'POST /auth/sign-out': { status: 204 } });
    // A connection that ignores `versionchange` blocks the deletion.
    const holder = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(`pesly-${USER}`);
      request.onsuccess = () => {
        resolve(request.result);
      };
    });

    await userEvent.setup().click(screen.getByRole('button', { name: 'sign out' }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(readWipeMarker()).toEqual([USER]);
    expect(readSessionPointer()).toBeNull();
    holder.close();
    await waitFor(async () => {
      expect(await databaseNames()).not.toContain(`pesly-${USER}`);
    });
  });

  it('error: a wipe that answers unavailable still completes the sign out', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    const { router } = renderApp(<SignOutProbe />);
    stubApi({ 'POST /auth/sign-out': { status: 204 } });

    await userEvent.setup().click(screen.getByRole('button', { name: 'sign out' }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
    expect(readWipeMarker()).toEqual([USER]);
    expect(readSessionPointer()).toBeNull();
  });
});

describe('SignOutConfirmation (AC-03)', () => {
  it.each([
    ['es', 1, '1 cambio todavía no se envió. Si cierras sesión ahora, se perderá.'],
    ['es', 4, '4 cambios todavía no se enviaron. Si cierras sesión ahora, se perderán.'],
    ['en', 1, '1 change has not been sent yet. If you sign out now, it will be lost.'],
    ['en', 4, '4 changes have not been sent yet. If you sign out now, they will be lost.'],
  ] as const)(
    'renders in %s for %i change(s) with the right plural (AC-03)',
    (locale, count, body) => {
      renderApp(
        <SignOutConfirmation
          count={count}
          signingOut={false}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
        { locale },
      );

      const messages = CATALOGS[locale].auth.signOut;
      const dialog = screen.getByRole('alertdialog', { name: messages.confirmTitle });
      const describedBy = dialog.getAttribute('aria-describedby');
      expect(describedBy).not.toBeNull();
      expect(document.getElementById(describedBy ?? '')?.textContent).toBe(body);
      expect(within(dialog).getByRole('button', { name: messages.confirm })).toBeDefined();
      expect(within(dialog).getByRole('button', { name: messages.cancel })).toBeDefined();
    },
  );

  it('moves the focus to cancel and calls back on each button', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderApp(
      <SignOutConfirmation
        count={2}
        signingOut={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
      { locale: 'en' },
    );

    const cancel = screen.getByRole('button', { name: en.auth.signOut.cancel });
    expect(document.activeElement).toBe(cancel);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: en.auth.signOut.confirm }));
    await user.click(cancel);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('cancels on Escape (AC-03)', async () => {
    const onCancel = vi.fn();
    renderApp(
      <SignOutConfirmation count={1} signingOut={false} onConfirm={vi.fn()} onCancel={onCancel} />,
    );

    await userEvent.setup().keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('ignores Escape while signing out', async () => {
    const onCancel = vi.fn();
    renderApp(<SignOutConfirmation count={1} signingOut onConfirm={vi.fn()} onCancel={onCancel} />);

    screen.getByRole('alertdialog').focus();
    await userEvent.setup().keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('disables both buttons while signing out', () => {
    renderApp(<SignOutConfirmation count={2} signingOut onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: es.auth.signOut.confirm }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: es.auth.signOut.cancel }).hasAttribute('disabled'),
    ).toBe(true);
  });
});
