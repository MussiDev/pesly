'use client';

import { useLocale } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import type { ApiFailure } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format-amount';
import { browserTimeZone } from '@/features/home/time-zone';
import { InvitePanel, type InvitationView } from '../components/invite-panel';
import { buildGroupLink } from '../group-link';

/** An expiry in the given zone; a stored zone the browser rejects falls back to the browser's. */
function formatExpiry(iso: string, timeZone: string, language: 'es' | 'en'): string {
  try {
    return formatDateTime(iso, timeZone, language);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return formatDateTime(iso, browserTimeZone(), language);
  }
}

/** Creates an invitation for the group and shows its link. Online only. */
export function GroupInviteContainer({ groupId }: { groupId: string }) {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  const [invitation, setInvitation] = useState<InvitationView>();
  const [issue, setIssue] = useState<ApiFailure>();

  async function create() {
    if (pending) return;
    setPending(true);
    setIssue(undefined);
    const result = await api.createInvitation(groupId);
    if (!result.ok) {
      setPending(false);
      if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else setIssue(result);
      return;
    }
    // The profile is read only now, so opening a group costs no extra request; if it cannot be
    // read, the browser's zone is the best available.
    const profile = await api.getProfile();
    const timeZone = profile.ok ? profile.data.preferences.timeZone : browserTimeZone();
    setInvitation({
      link: buildGroupLink('join', result.data.token, window.location.origin, locale),
      expiresOn: formatExpiry(result.data.expiresAt, timeZone, locale === 'en' ? 'en' : 'es'),
    });
    setPending(false);
  }

  return (
    <InvitePanel
      pending={pending}
      invitation={invitation}
      issue={issue}
      onCreate={() => {
        void create();
      }}
    />
  );
}
