'use client';

import { useLocale } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { UnreadBadgeContainer } from '@/features/notices/containers/unread-badge-container';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { useOnlineStatus } from '@/lib/connectivity';
import { readQueueCounts } from '@/lib/local-store/device-copy';
import { requestPersistentStorage } from '@/lib/local-store/persistence';
import type { QueueCounts } from '@/lib/local-store/queue';
import {
  readSessionPointer,
  SESSION_POINTER_KEY,
  writeSessionPointer,
} from '@/lib/local-store/session-pointer';
import { resumePendingWipes } from '@/lib/local-store/wipe';
import { removeFromWipeMarker } from '@/lib/local-store/wipe-marker';
import { requestShellWarmup } from '@/lib/service-worker/warmup';
import { onMovementQueued, onQueueChanged, onSyncFinished } from '@/lib/sync/sync-events';
import { cancelSyncRetry, syncMovementQueue } from '@/lib/sync/sync-queue';
import { AuthenticatedShell, type ShellState } from '../components/authenticated-shell';
import { SignOutConfirmation } from '../components/sign-out-confirmation';
import { StorageWarning } from '../components/storage-warning';
import { SyncStatus } from '../components/sync-status';
import { useSignOut } from '../use-sign-out';

/**
 * Guards the authenticated area. The session is checked client-side against the API (no Server
 * Component touches credentials): no session → sign-in; unverified email → "check your email"
 * (AC-04). Any other failure (offline included) offers a retry instead of signing the user out.
 */
export function AuthenticatedShellContainer({ children }: { children: ReactNode }) {
  const api = useApiClient();
  const router = useRouter();
  // Outside Next.js (unit tests) there is no pathname; nothing is marked as current then.
  const pathname = usePathname() as string | null;
  const online = useOnlineStatus();
  const locale = useLocale();
  const [state, setState] = useState<ShellState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [storageDenied, setStorageDenied] = useState(false);
  // Who the API confirmed in this visit. The queue is only sent for this user, never for whoever the
  // pointer names, so one user's movements cannot leave under another user's session.
  const [confirmedUser, setConfirmedUser] = useState<string | undefined>();
  const { signingOut, signOutError, confirming, requestSignOut, confirmSignOut, cancelSignOut } =
    useSignOut();
  const [queueCounts, setQueueCounts] = useState<QueueCounts>({ pending: 0, failed: 0 });

  // A wipe an earlier visit left half way is finished first; it never throws and keeps the marker.
  useEffect(() => {
    void resumePendingWipes();
  }, []);

  // Another tab signed out: its wipe removed the pointer, so this tab has no session either.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_POINTER_KEY && event.newValue === null) router.replace('/sign-in');
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, [router]);

  useEffect(() => {
    // Without a connection the app opens from what the last online visit left: the pointer names
    // a verified user and nothing else is asked of the API.
    const openFromPointer = (): boolean => {
      if (readSessionPointer()?.emailVerified !== true) return false;
      setState({ kind: 'ready' });
      return true;
    };
    if (!online) {
      setConfirmedUser(undefined);
      if (!openFromPointer()) setState({ kind: 'failed', error: 'offlineNoCopy' });
      return;
    }
    let active = true;
    void api.getSession().then((result) => {
      if (!active) return;
      if (!result.ok) {
        if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else if (result.code === 'NETWORK' && openFromPointer()) return;
        else setState({ kind: 'failed', error: result.messageKey });
        return;
      }
      // The API confirmed this user again: their database may be opened (empty) and filled again.
      removeFromWipeMarker(result.data.user.id);
      writeSessionPointer({
        userId: result.data.user.id,
        emailVerified: result.data.user.emailVerified,
      });
      if (!result.data.user.emailVerified) router.replace('/check-your-email');
      else {
        setConfirmedUser(result.data.user.id);
        setState({ kind: 'ready' });
      }
    });
    return () => {
      active = false;
    };
  }, [api, router, attempt, online]);

  // Once the session is confirmed and there is a connection, the worker is asked to keep the two
  // screens the offline flow needs. Nothing happens, and nothing breaks, without a worker.
  useEffect(() => {
    if (state.kind === 'ready' && online) void requestShellWarmup(locale);
  }, [state.kind, online, locale]);

  // The movements saved without a connection go out once the session is confirmed online, when the
  // connection returns, and when a save falls back to the queue. One pass at a time (see the queue).
  useEffect(() => {
    if (confirmedUser === undefined || !online) return;
    const run = () => {
      void syncMovementQueue(confirmedUser, api);
    };
    run();
    const stopListening = onMovementQueued(run);
    return () => {
      stopListening();
      cancelSyncRetry();
    };
  }, [confirmedUser, online, api]);

  // What waits on this device for the user it knows, offline too; read again whenever the queue
  // changes or a pass ends. A queue that cannot be read counts as empty.
  useEffect(() => {
    if (state.kind !== 'ready') return;
    let live = true;
    const read = () => {
      void readQueueCounts(readSessionPointer()?.userId).then((counts) => {
        if (live) setQueueCounts(counts);
      });
    };
    read();
    const stopQueue = onQueueChanged(read);
    const stopSync = onSyncFinished(read);
    return () => {
      live = false;
      stopQueue();
      stopSync();
    };
  }, [state.kind]);

  // The offline copy is only worth keeping if the browser does not evict it: ask once the shell is
  // ready and warn when the answer is no. A browser without the Storage API says nothing.
  useEffect(() => {
    if (state.kind !== 'ready') return;
    let active = true;
    void requestPersistentStorage().then((result) => {
      if (active && result === 'denied') setStorageDenied(true);
    });
    return () => {
      active = false;
    };
  }, [state.kind]);

  return (
    <AuthenticatedShell
      state={state}
      currentPath={pathname ?? undefined}
      signingOut={signingOut}
      signOutError={signOutError}
      onRetry={() => {
        setState({ kind: 'loading' });
        setAttempt((value) => value + 1);
      }}
      onSignOut={() => {
        void requestSignOut();
      }}
      signOutConfirmation={
        confirming !== undefined ? (
          <SignOutConfirmation
            count={confirming}
            signingOut={signingOut}
            onConfirm={() => {
              void confirmSignOut();
            }}
            onCancel={cancelSignOut}
          />
        ) : null
      }
      notices={state.kind === 'ready' ? <UnreadBadgeContainer /> : null}
      syncStatus={<SyncStatus pending={queueCounts.pending} failed={queueCounts.failed} />}
    >
      {children}
      {/* After the content: it arrives late and must not push the screen down (NFR-03). */}
      {storageDenied ? <StorageWarning /> : null}
    </AuthenticatedShell>
  );
}
