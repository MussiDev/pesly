'use client';

import type { GroupResponse } from '@pesly/shared';
import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { GroupsList } from '../components/groups-list';
import { GroupsLoadStateView, type GroupsLoadState } from '../components/groups-load-state';

type ScreenState = GroupsLoadState | { kind: 'ready'; groups: GroupResponse[] };

/** The groups list screen. Online only: nothing is kept on the device. */
export function GroupsListContainer() {
  const api = useApiClient();
  const router = useRouter();
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void api.listGroups().then((result) => {
      if (!active) return;
      if (result.ok) setState({ kind: 'ready', groups: result.data });
      else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else setState({ kind: 'failed', error: result.messageKey });
    });
    return () => {
      active = false;
    };
  }, [api, router, attempt]);

  if (state.kind !== 'ready') {
    return (
      <GroupsLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }
  return <GroupsList groups={state.groups} />;
}
