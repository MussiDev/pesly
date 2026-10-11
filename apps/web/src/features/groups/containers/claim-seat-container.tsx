'use client';

import { useApiClient } from '@/lib/api-client-provider';
import { LinkResult } from '../components/link-result';
import { useGroupLink } from '../use-group-link';

/** `groups/claim#token=...`: takes over a ghost member's seat as soon as the page opens. */
export function ClaimSeatContainer() {
  const api = useApiClient();
  const { state, retry } = useGroupLink((token) => api.claimGroupSeat(token));
  return <LinkResult kind="claim" state={state} onRetry={retry} />;
}
