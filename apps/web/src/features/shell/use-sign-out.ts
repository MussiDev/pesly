'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { type ApiErrorKey } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';

/** The sign-out flow shared by the shell and the More page. */
export function useSignOut() {
  const api = useApiClient();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<ApiErrorKey | undefined>();

  async function signOut(): Promise<void> {
    setSigningOut(true);
    setSignOutError(undefined);
    const result = await api.signOut();
    if (result.ok) {
      router.replace('/sign-in');
      return;
    }
    setSigningOut(false);
    setSignOutError(result.messageKey);
  }

  return { signingOut, signOutError, signOut };
}
