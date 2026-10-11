'use client';

import { useApiClient } from '@/lib/api-client-provider';
import { LinkResult } from '../components/link-result';
import { useGroupLink } from '../use-group-link';

/** `groups/join#token=...`: joins the group the invitation belongs to as soon as the page opens. */
export function JoinGroupContainer() {
  const api = useApiClient();
  const { state, retry } = useGroupLink((token) => api.joinGroup(token));
  return <LinkResult kind="join" state={state} onRetry={retry} />;
}
