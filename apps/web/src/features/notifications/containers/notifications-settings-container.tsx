'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { ApiFailure } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { useOnlineStatus } from '@/lib/connectivity';
import { readSubscription, subscribe, unsubscribe } from '@/lib/push/push-client';
import { detectPushSupport } from '@/lib/push/push-support';
import {
  NotificationsSettings,
  type NotificationsError,
  type NotificationsView,
} from '../components/notifications-settings';

type Action = 'enable' | 'disable';

/**
 * Per-device push notifications. The permission is asked only by `enable`, which only the explicit
 * tap on "Enable notifications" calls; opening the screen reads the permission and never asks (FR-03).
 * With a browser subscription the screen re-registers it each time it opens, so a subscription the
 * server lost or the browser rotated is repaired (FR-21).
 */
export function NotificationsSettingsContainer() {
  const api = useApiClient();
  const router = useRouter();
  const online = useOnlineStatus();
  const [view, setView] = useState<NotificationsView>({ kind: 'loading' });
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<NotificationsError | undefined>();
  const [pending, setPending] = useState<Action | undefined>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    // A function, so the checks after each await are not narrowed away by the compiler.
    const stopped = () => !active;
    async function load() {
      const support = detectPushSupport();
      if (support === 'unsupported') {
        setView({ kind: 'unsupported' });
        return;
      }
      if (support === 'ios-needs-install') {
        setView({ kind: 'ios-needs-install', explained: false });
        return;
      }
      if (support === 'blocked') {
        setView({ kind: 'blocked' });
        return;
      }

      const config = await api.getPushConfig();
      if (stopped()) return;
      if (!config.ok) {
        if (config.code === 'UNAUTHENTICATED') router.replace('/sign-in');
        else setView({ kind: 'config-failed' });
        return;
      }
      if (!config.data.available || config.data.publicKey === null) {
        setView({ kind: 'unavailable' });
        return;
      }
      setPublicKey(config.data.publicKey);

      const existing = Notification.permission === 'granted' ? await readSubscription() : null;
      if (stopped()) return;
      if (existing === null) {
        setView({ kind: 'off' });
        return;
      }
      setView({ kind: 'on' });
      const stored = await api.storePushSubscription(existing);
      if (stopped() || stored.ok) return;
      if (stored.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else setError('sync');
    }
    void load();
    return () => {
      active = false;
    };
  }, [api, router, attempt]);

  /** Ends a failed action: back to sign-in when the session is gone, else the retryable message. */
  function fail(failure: ApiFailure | undefined, action: NotificationsError) {
    setPending(undefined);
    if (failure?.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    else setError(action);
  }

  async function enable() {
    if (view.kind === 'ios-needs-install') {
      // Explains the Home Screen requirement; the permission is never asked from here.
      setView({ kind: 'ios-needs-install', explained: true });
      return;
    }
    if (publicKey === null) return;
    setPending('enable');
    setError(undefined);
    const result = await subscribe(publicKey);
    if (!result.ok) {
      if (result.reason === 'denied') {
        setPending(undefined);
        setView({ kind: 'blocked' });
      } else {
        fail(undefined, 'enable');
      }
      return;
    }
    const stored = await api.storePushSubscription(result.subscription);
    if (!stored.ok) {
      // The server does not know this subscription, so the browser must not keep it either.
      await unsubscribe();
      fail(stored, 'enable');
      return;
    }
    setPending(undefined);
    setView({ kind: 'on' });
  }

  async function disable() {
    setPending('disable');
    setError(undefined);
    const current = await readSubscription();
    if (current !== null) {
      const removed = await api.removePushSubscription({ endpoint: current.endpoint });
      // A 404 means the server no longer has it: that is the state wanted.
      if (!removed.ok && removed.code !== 'NOT_FOUND') {
        fail(removed, 'disable');
        return;
      }
    }
    if (!(await unsubscribe())) {
      fail(undefined, 'disable');
      return;
    }
    setPending(undefined);
    setView({ kind: 'off' });
  }

  function retry() {
    if (view.kind === 'config-failed') {
      setView({ kind: 'loading' });
      setAttempt((value) => value + 1);
    } else if (error === 'enable') {
      void enable();
    } else if (error === 'disable') {
      void disable();
    } else {
      setError(undefined);
      setAttempt((value) => value + 1);
    }
  }

  return (
    <NotificationsSettings
      view={view}
      error={error}
      pending={pending !== undefined}
      pendingAction={pending}
      offline={!online}
      onEnable={() => {
        void enable();
      }}
      onDisable={() => {
        void disable();
      }}
      onRetry={retry}
    />
  );
}
