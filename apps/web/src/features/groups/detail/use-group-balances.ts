'use client';

import type { BalancesResponse } from '@pesly/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApiClient } from '@/lib/api-client-provider';
import type { FatalCode } from './use-recent-expenses';

export type GroupBalancesState =
  { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; balances: BalancesResponse };

/**
 * The balances of one group, for the own-balance summary and the suggested payments. Like the
 * recent expenses, a 401 or 404 goes to `onFatal` and any other failure is a `failed` state of this
 * section only. `reload` keeps what is on screen while it runs; `retry` shows the loading state.
 */
export function useGroupBalances(groupId: string, onFatal: (code: FatalCode) => void) {
  const api = useApiClient();
  const [state, setState] = useState<GroupBalancesState>({ kind: 'loading' });
  // Bumped by every request and by unmount, so only the newest answer is applied.
  const generation = useRef(0);
  const fatal = useRef(onFatal);
  fatal.current = onFatal;

  const load = useCallback(
    async (quiet: boolean) => {
      generation.current += 1;
      const current = generation.current;
      if (!quiet) setState({ kind: 'loading' });
      const result = await api.getGroupBalances(groupId);
      if (current !== generation.current) return;
      if (result.ok) setState({ kind: 'ready', balances: result.data });
      else if (result.code === 'UNAUTHENTICATED' || result.code === 'NOT_FOUND') {
        fatal.current(result.code);
      } else setState({ kind: 'failed' });
    },
    [api, groupId],
  );

  useEffect(() => {
    void load(true);
    return () => {
      generation.current += 1;
    };
  }, [load]);

  return {
    state,
    reload: useCallback(() => load(true), [load]),
    retry: useCallback(() => load(false), [load]),
  };
}
