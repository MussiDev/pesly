'use client';

import {
  deleteUserRequestSchema,
  type DeleteUserRequest,
  type ProfileResponse,
} from '@pesly/shared';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { toFormErrors, type ErrorMessageKey, type FormErrors } from '@/features/auth/form-errors';
import { useRouter } from '@/i18n/navigation';
import type { ApiErrorKey } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { DeleteUserForm, type DeleteUserFormValues } from '../components/delete-user-form';
import { DeleteUserGoogle } from '../components/delete-user-google';
import { ProfileLoadStateView } from '../components/profile-load-state';

type State =
  | { kind: 'loading' }
  | { kind: 'failed'; error: ApiErrorKey }
  | { kind: 'ready'; profile: ProfileResponse };

/** What the API's Google callback left in the address bar: a flag, never a token (A-6). */
type ReauthFlag = 'ready' | 'failed' | 'none';

function readReauthFlag(): ReauthFlag {
  const flag = new URL(window.location.href).searchParams.get('reauth');
  return flag === 'ready' || flag === 'failed' ? flag : 'none';
}

/** The shared schema's issues on the fields this screen shows; the API stays the authority. */
function toDeleteValidationErrors(error: z.ZodError): FormErrors {
  const errors: FormErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field === 'password') {
      const missing = issue.code === 'too_small' || issue.code === 'invalid_type';
      errors.fields = {
        ...errors.fields,
        password: missing ? 'passwordRequired' : 'passwordTooLong',
      };
    } else if (field === 'secondFactorCode') {
      errors.fields = { ...errors.fields, code: 'secondFactorCodeFormat' };
    } else {
      errors.form ??= 'validationFailed';
    }
  }
  return errors;
}

/**
 * Delete-account screen. A user with a password sends it (and the second-factor code when 2FA is
 * on). A user without one first confirms with Google: the first step sends the browser to Google,
 * the API's callback brings it back with `?reauth=ready` and an HttpOnly grant cookie, and the
 * final form then deletes with no password. The password and the code are never kept after a
 * submit and never put in a URL.
 */
export function DeleteUserContainer() {
  const t = useTranslations('deleteUser');
  const api = useApiClient();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [reauth, setReauth] = useState<ReauthFlag | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [googleError, setGoogleError] = useState<ErrorMessageKey | undefined>();
  /** Remounts the form, which empties its fields after a refused submit. */
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setReauth(readReauthFlag());
  }, []);

  useEffect(() => {
    let active = true;
    void api.getProfile().then((result) => {
      if (!active) return;
      if (result.ok) setState({ kind: 'ready', profile: result.data });
      else if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else setState({ kind: 'failed', error: result.messageKey });
    });
    return () => {
      active = false;
    };
  }, [api, router, attempt]);

  function retry() {
    setState({ kind: 'loading' });
    setAttempt((value) => value + 1);
  }

  if (state.kind === 'loading' || reauth === undefined) {
    return <ProfileLoadStateView state={{ kind: 'loading' }} cards={1} onRetry={retry} />;
  }

  if (state.kind === 'failed') {
    return <ProfileLoadStateView state={state} cards={1} onRetry={retry} />;
  }

  const { profile } = state;
  const googlePath = profile.deletionReauth === 'google';
  const confirmed = googlePath && reauth === 'ready';

  async function startReauth() {
    setPending(true);
    setGoogleError(undefined);
    setReauth('none');
    const result = await api.startDeletionReauth();
    if (!result.ok) {
      setPending(false);
      if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
      else setGoogleError(result.messageKey);
      return;
    }
    // The page is left for Google; the button stays disabled until then.
    window.location.assign(result.data.authorizationUrl);
  }

  async function deleteAccount(values: DeleteUserFormValues) {
    const body: DeleteUserRequest = {};
    if (!googlePath) body.password = values.password;
    if (profile.twoFactorEnabled) body.secondFactorCode = values.code;
    const parsed = deleteUserRequestSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(toDeleteValidationErrors(parsed.error));
      setRevision((value) => value + 1);
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.deleteMyAccount(parsed.data);
    if (result.ok || result.code === 'UNAUTHENTICATED') {
      // The account is gone (or the session is): either way this browser has nothing to show.
      router.replace('/sign-in');
      return;
    }
    setPending(false);
    setRevision((value) => value + 1);
    if (googlePath && result.code === 'REAUTHENTICATION_REQUIRED') {
      // The grant expired or was used: the confirmation with Google has to start again.
      setReauth('none');
      setErrors({});
      setGoogleError(result.messageKey);
      return;
    }
    setErrors(toFormErrors(result));
  }

  if (googlePath && !confirmed) {
    return (
      <DeleteUserGoogle
        pending={pending}
        failed={reauth === 'failed'}
        error={googleError}
        onStart={() => {
          void startReauth();
        }}
      />
    );
  }

  return (
    <div className="grid gap-6">
      {confirmed ? <p className="text-sm text-muted-foreground">{t('google.confirmed')}</p> : null}
      <DeleteUserForm
        key={revision}
        requirePassword={!googlePath}
        requireCode={profile.twoFactorEnabled}
        pending={pending}
        errors={errors}
        onSubmit={(values) => {
          void deleteAccount(values);
        }}
      />
    </div>
  );
}
