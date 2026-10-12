'use client';

import { SIGN_IN_ERRORS, signInRequestSchema, type SignInError } from '@pesly/shared';
import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { SignInForm, type SignInFormValues } from '../components/sign-in-form';
import {
  toFormErrors,
  toValidationErrors,
  type FormErrors,
  type RedirectErrorKey,
} from '../form-errors';
import { useGoogleStartUrl } from '../google-start-url';
import { readReturnPath } from '../read-return-path';

const MESSAGE_BY_SIGN_IN_ERROR: Record<SignInError, RedirectErrorKey> = {
  google_failed: 'googleFailed',
  second_factor_expired: 'secondFactorExpired',
};

function isSignInError(value: string | null): value is SignInError {
  return SIGN_IN_ERRORS.some((known) => known === value);
}

/**
 * The API sends a failed Google sign-in back here with `?error=google_failed`, and the
 * second-factor screen an expired challenge with `?error=second_factor_expired`. The parameter is
 * removed from the address bar so a reload does not show the error again; other values are ignored.
 */
function takeSignInError(): SignInError | null {
  const url = new URL(window.location.href);
  const error = url.searchParams.get('error');
  if (!isSignInError(error)) return null;
  url.searchParams.delete('error');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  return error;
}

export function SignInContainer() {
  const api = useApiClient();
  const router = useRouter();
  const googleStartUrl = useGoogleStartUrl();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    const error = takeSignInError();
    if (error) setErrors({ form: MESSAGE_BY_SIGN_IN_ERROR[error] });
  }, []);

  async function signIn(values: SignInFormValues) {
    const parsed = signInRequestSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(toValidationErrors(parsed.error));
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.signIn(parsed.data);
    if (!result.ok) {
      setPending(false);
      setErrors(toFormErrors(result));
      return;
    }
    if (result.data.status === 'second_factor_required') {
      const next = readReturnPath();
      router.replace(
        next === undefined
          ? '/sign-in/second-factor'
          : `/sign-in/second-factor?next=${encodeURIComponent(next)}`,
      );
      return;
    }
    const { user } = result.data;
    // The app opens in the account's language (FR-11); unverified accounts go to verification.
    router.replace(user.emailVerified ? (readReturnPath() ?? '/') : '/check-your-email', {
      locale: user.language,
    });
  }

  return (
    <SignInForm
      pending={pending}
      errors={errors}
      googleStartUrl={googleStartUrl}
      onSubmit={(values) => {
        void signIn(values);
      }}
    />
  );
}
