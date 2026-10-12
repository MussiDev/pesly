'use client';

import { secondFactorVerifyRequestSchema, totpCodeSchema } from '@pesly/shared';
import { useState } from 'react';
import { z } from 'zod';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { SecondFactorForm, type SecondFactorMode } from '../components/second-factor-form';
import { toFormErrors, toValidationErrors, type FormErrors } from '../form-errors';
import { readReturnPath } from '../read-return-path';

/** The authenticator mode only takes 6 digits; the recovery mode, either kind of code. */
const totpRequestSchema = z.object({ code: totpCodeSchema });

/**
 * Posts the second factor; the challenge from the first factor travels in its own HttpOnly
 * cookie. When the challenge is gone (expired, used up, or never started) the user goes back to
 * sign-in, which explains why.
 */
export function SecondFactorContainer() {
  const api = useApiClient();
  const router = useRouter();
  const [mode, setMode] = useState<SecondFactorMode>('totp');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  async function verify(code: string) {
    const schema = mode === 'totp' ? totpRequestSchema : secondFactorVerifyRequestSchema;
    const parsed = schema.safeParse({ code });
    if (!parsed.success) {
      setErrors(
        toValidationErrors(
          parsed.error,
          {},
          mode === 'totp' ? 'totpCodeFormat' : 'secondFactorCodeFormat',
        ),
      );
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.verifySecondFactor(parsed.data);
    if (!result.ok) {
      if (result.code === 'SECOND_FACTOR_EXPIRED') {
        router.replace('/sign-in?error=second_factor_expired');
        return;
      }
      setPending(false);
      setErrors(toFormErrors(result));
      return;
    }
    const { user } = result.data;
    router.replace(user.emailVerified ? (readReturnPath() ?? '/') : '/check-your-email', {
      locale: user.language,
    });
  }

  return (
    <SecondFactorForm
      mode={mode}
      pending={pending}
      errors={errors}
      onSubmit={(code) => {
        void verify(code);
      }}
      onModeChange={(next) => {
        setMode(next);
        setErrors({});
      }}
    />
  );
}
