'use client';

import type { GroupResponse } from '@pesly/shared';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { ApiResult } from '@/lib/api-client';
import { takeFragmentToken } from './take-fragment-token';

export type LinkFailure =
  'invalid' | 'alreadyMember' | 'full' | 'signIn' | 'network' | 'unexpected';
export type LinkState = { kind: 'working' } | { kind: 'failed'; reason: LinkFailure };

const REASON_BY_CODE: Record<string, LinkFailure> = {
  TOKEN_INVALID: 'invalid',
  VALIDATION_FAILED: 'invalid',
  NOT_FOUND: 'invalid',
  GROUP_ALREADY_MEMBER: 'alreadyMember',
  GROUP_MEMBER_LIMIT_REACHED: 'full',
  UNAUTHENTICATED: 'signIn',
  NETWORK: 'network',
};

/**
 * Takes the link token from the address once, then sends it with `send` once per attempt. The token
 * is kept in memory only, so a retry after a network failure does not need the link again.
 */
export function useGroupLink(send: (token: string) => Promise<ApiResult<GroupResponse>>) {
  const router = useRouter();
  const started = useRef(false);
  const token = useRef<string | null>(null);
  const [state, setState] = useState<LinkState>({ kind: 'working' });

  function attempt(value: string) {
    setState({ kind: 'working' });
    void send(value).then((result) => {
      if (result.ok) {
        router.replace(`/groups/${encodeURIComponent(result.data.id)}`);
        return;
      }
      setState({ kind: 'failed', reason: REASON_BY_CODE[result.code] ?? 'unexpected' });
    });
  }

  useEffect(() => {
    // React's development remount runs this again: a second request would find the token used.
    if (started.current) return;
    started.current = true;
    const taken = takeFragmentToken();
    if (taken === null || taken === '') {
      setState({ kind: 'failed', reason: 'invalid' });
      return;
    }
    token.current = taken;
    attempt(taken);
  }, []);

  return {
    state,
    retry: () => {
      if (token.current !== null) attempt(token.current);
    },
  };
}
