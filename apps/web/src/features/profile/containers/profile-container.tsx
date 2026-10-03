'use client';

import {
  updateProfileRequestSchema,
  type ProfileResponse,
  type UpdateProfileRequest,
} from '@pesly/shared';
import { TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import type { ApiErrorKey, ApiResult } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { PreferencesForm, type PreferencesValues } from '../components/preferences-form';
import { ProfileForm } from '../components/profile-form';
import { ProfileLoadStateView } from '../components/profile-load-state';
import {
  toProfileFailure,
  toProfileValidationErrors,
  type ProfileFormErrors,
} from '../profile-errors';
import { timeZoneOptions } from '../time-zones';

type State =
  | { kind: 'loading' }
  | { kind: 'failed'; error: ApiErrorKey }
  | { kind: 'ready'; profile: ProfileResponse };

/** What one form shows. `revision` remounts it, which resets its fields to the saved values. */
interface FormState {
  pending: boolean;
  saved: boolean;
  errors: ProfileFormErrors;
  revision: number;
}

const IDLE: FormState = { pending: false, saved: false, errors: {}, revision: 0 };

/** The screen is always served at this path; used when Next.js reports none (outside the app). */
const PROFILE_PATH = '/settings/profile';

/**
 * Profile and preferences. Each form saves on its own with `PATCH /profile`, sending only the
 * fields that changed and never the email (FR-03); the shared schemas validate first, so the same
 * rules give instant feedback and the API stays the authority.
 */
export function ProfileContainer() {
  const tDelete = useTranslations('profile.deleteAccount');
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const pathname = usePathname() as string | null;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [account, setAccount] = useState<FormState>(IDLE);
  const [preferences, setPreferences] = useState<FormState>(IDLE);

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

  const savedTimeZone = state.kind === 'ready' ? state.profile.preferences.timeZone : '';
  const timeZones = useMemo(() => timeZoneOptions(savedTimeZone), [savedTimeZone]);

  if (state.kind === 'loading' || state.kind === 'failed') {
    return (
      <ProfileLoadStateView
        state={state}
        cards={3}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((value) => value + 1);
        }}
      />
    );
  }

  const { profile } = state;

  /**
   * Sends `changes` (already validated) and settles the form: saved, or the failure above it. A
   * 400 resets the fields to the saved values; a lost connection keeps what was typed so the form
   * can be submitted again.
   */
  async function send(
    setForm: (update: (form: FormState) => FormState) => void,
    changes: UpdateProfileRequest,
    apply: (saved: ProfileResponse) => void,
  ) {
    setForm((form) => ({ ...form, pending: true, saved: false, errors: {} }));
    const result: ApiResult<ProfileResponse> = await api.updateProfile(changes);
    if (result.ok) {
      apply(result.data);
      setForm((form) => ({ pending: false, saved: true, errors: {}, revision: form.revision + 1 }));
      return;
    }
    if (result.code === 'UNAUTHENTICATED') {
      router.replace('/sign-in');
      return;
    }
    setForm((form) => ({
      pending: false,
      saved: false,
      errors: toProfileFailure(result),
      revision: result.code === 'VALIDATION_FAILED' ? form.revision + 1 : form.revision,
    }));
  }

  function saveAccount(values: { displayName: string }) {
    const parsed = updateProfileRequestSchema.safeParse(values);
    if (!parsed.success) {
      setAccount((form) => ({
        ...form,
        saved: false,
        errors: toProfileValidationErrors(parsed.error, values),
      }));
      return;
    }
    if (parsed.data.displayName === profile.displayName) {
      setAccount((form) => ({ ...IDLE, saved: true, revision: form.revision + 1 }));
      return;
    }
    void send(setAccount, parsed.data, (saved) => {
      setState((prev) =>
        prev.kind === 'ready'
          ? { kind: 'ready', profile: { ...prev.profile, displayName: saved.displayName } }
          : prev,
      );
    });
  }

  function savePreferences(values: PreferencesValues) {
    const changes: UpdateProfileRequest = {};
    if (values.defaultRateType !== profile.preferences.defaultRateType) {
      changes.defaultRateType = values.defaultRateType;
    }
    if (values.displayCurrency !== profile.preferences.displayCurrency) {
      changes.displayCurrency = values.displayCurrency;
    }
    if (values.timeZone !== profile.preferences.timeZone) changes.timeZone = values.timeZone;
    if (values.language !== profile.preferences.language) changes.language = values.language;

    if (Object.keys(changes).length === 0) {
      setPreferences((form) => ({ ...IDLE, saved: true, revision: form.revision + 1 }));
      return;
    }
    const parsed = updateProfileRequestSchema.safeParse(changes);
    if (!parsed.success) {
      setPreferences((form) => ({
        ...form,
        saved: false,
        errors: toProfileValidationErrors(parsed.error, changes),
      }));
      return;
    }
    void send(setPreferences, parsed.data, (saved) => {
      setState((prev) =>
        prev.kind === 'ready'
          ? { kind: 'ready', profile: { ...prev.profile, preferences: saved.preferences } }
          : prev,
      );
      // Every screen shows in the saved language, so the route follows it (AC-09).
      if (saved.preferences.language !== locale) {
        router.replace(pathname ?? PROFILE_PATH, { locale: saved.preferences.language });
      }
    });
  }

  return (
    <div className="grid gap-6">
      <ProfileForm
        key={`account-${account.revision}`}
        displayName={profile.displayName}
        email={profile.email}
        twoFactorEnabled={profile.twoFactorEnabled}
        pending={account.pending}
        saved={account.saved}
        errors={account.errors}
        onSubmit={saveAccount}
      />
      <PreferencesForm
        key={`preferences-${preferences.revision}`}
        preferences={profile.preferences}
        timeZones={timeZones}
        pending={preferences.pending}
        saved={preferences.saved}
        errors={preferences.errors}
        onSubmit={savePreferences}
      />
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2 text-destructive">
            <TriangleAlert aria-hidden className="size-5 shrink-0" />
            {tDelete('title')}
          </CardTitle>
          <CardDescription>{tDelete('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/settings/delete-account" className={buttonVariants({ variant: 'outline' })}>
            {tDelete('link')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
