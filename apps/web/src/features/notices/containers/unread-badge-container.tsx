'use client';

import { useEffect, useState } from 'react';
import { useApiClient } from '@/lib/api-client-provider';
import { useOnlineStatus } from '@/lib/connectivity';
import { NoticesLink, UnreadCount } from '../components/notices-link';
import { onNoticesChanged } from '../notices-events';

/**
 * Asks the API for the unread count (the first page with `limit=1` carries it) when it mounts and
 * whenever the notices screen changes it. While loading and on any failure there is no number, and
 * nothing else in the shell is affected.
 */
export function UnreadBadgeContainer({ variant = 'link' }: { variant?: 'link' | 'count' }) {
  const api = useApiClient();
  const online = useOnlineStatus();
  const [count, setCount] = useState<number | undefined>();
  const [version, setVersion] = useState(0);

  useEffect(
    () =>
      onNoticesChanged(() => {
        setVersion((current) => current + 1);
      }),
    [],
  );

  useEffect(() => {
    if (!online) {
      setCount(undefined);
      return;
    }
    let active = true;
    void api.listNotices({ limit: 1 }).then((result) => {
      if (active) setCount(result.ok ? result.data.unreadCount : undefined);
    });
    return () => {
      active = false;
    };
  }, [api, online, version]);

  return variant === 'count' ? <UnreadCount count={count} /> : <NoticesLink count={count} />;
}
