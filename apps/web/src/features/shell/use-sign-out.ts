'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { type ApiErrorKey } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { readQueueCounts } from '@/lib/local-store/device-copy';
import { readSessionPointer } from '@/lib/local-store/session-pointer';
import { wipeLocalData } from '@/lib/local-store/wipe';
import { cancelSyncRetry } from '@/lib/sync/sync-queue';

/**
 * The sign-out flow shared by the shell and the More page. Changes not yet on the server are lost
 * on a sign out, so with any of them the user confirms first; the device is wiped only after the
 * API ended the session, never while a valid cookie remains.
 */
export function useSignOut() {
  const api = useApiClient();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<ApiErrorKey | undefined>();
  // How many changes would be lost while the confirmation is shown; `undefined` otherwise.
  const [confirming, setConfirming] = useState<number | undefined>();

  async function signOut(): Promise<void> {
    setSigningOut(true);
    setSignOutError(undefined);
    cancelSyncRetry();
    const result = await api.signOut();
    if (result.ok) {
      const userId = readSessionPointer()?.userId;
      // Whatever the wipe answers, the marker finishes it on the next start.
      if (userId !== undefined) await wipeLocalData(userId);
      router.replace('/sign-in');
      return;
    }
    setConfirming(undefined);
    setSigningOut(false);
    setSignOutError(result.messageKey);
  }

  async function requestSignOut(): Promise<void> {
    // A queue that cannot be read counts as zero: there is nothing on the device to lose.
    const counts = await readQueueCounts(readSessionPointer()?.userId);
    const total = counts.pending + counts.failed;
    if (total > 0) {
      setSignOutError(undefined);
      setConfirming(total);
      return;
    }
    await signOut();
  }

  function cancelSignOut(): void {
    setConfirming(undefined);
  }

  return {
    signingOut,
    signOutError,
    confirming,
    requestSignOut,
    confirmSignOut: signOut,
    cancelSignOut,
  };
}
