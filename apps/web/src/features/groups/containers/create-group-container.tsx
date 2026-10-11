'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { GroupsLoadStateView } from '../components/groups-load-state';
import { CreateGroupForm } from '../components/create-group-form';
import { createFailureErrors, type GroupFormErrors } from '../group-failure';
import { buildGroupRequest, type GroupFormValues } from '../group-request';

/** The new group screen. Online only: nothing is kept on the device. */
export function CreateGroupContainer() {
  const api = useApiClient();
  const router = useRouter();
  const [defaultRateType, setDefaultRateType] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<GroupFormErrors>({});

  // The user's usual rate type is only a preselection: if it cannot be read, `oficial` is used.
  // The form waits for the answer so a value the user already picked is never overwritten.
  useEffect(() => {
    let active = true;
    void api.getProfile().then((profile) => {
      if (!active) return;
      setDefaultRateType(profile.ok ? profile.data.preferences.defaultRateType : 'oficial');
    });
    return () => {
      active = false;
    };
  }, [api]);

  async function save(values: GroupFormValues) {
    if (pending) return;
    const { request, fields } = buildGroupRequest(values);
    if (request === undefined) {
      setErrors({ fields });
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.createGroup(request);
    if (result.ok) {
      router.push(`/groups/${encodeURIComponent(result.data.id)}`);
      return;
    }
    setPending(false);
    if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    // The form stays mounted, so what the user typed is still there for a retry.
    else setErrors(createFailureErrors(result));
  }

  if (defaultRateType === undefined) {
    return <GroupsLoadStateView state={{ kind: 'loading' }} onRetry={() => undefined} />;
  }

  return (
    <CreateGroupForm
      defaultRateType={defaultRateType}
      pending={pending}
      errors={errors}
      onSubmit={(values) => {
        void save(values);
      }}
    />
  );
}
