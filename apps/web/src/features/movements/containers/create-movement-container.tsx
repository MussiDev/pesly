'use client';

import {
  RATE_AGE_WARNING_MS,
  formatRateInput,
  instantToZonedLocal,
  rateAgeMs,
  type AccountResponse,
  type CategoryLanguage,
  type CategoryResponse,
  type RateType,
} from '@pesly/shared';
import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import {
  AccountsLoadStateView,
  type AccountsLoadState,
} from '@/features/accounts/components/accounts-load-state';
import { categoryLabel } from '@/features/categories/category-display';
import { useRouter } from '@/i18n/navigation';
import type { ApiResult } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { MovementForm, type MovementFormValues } from '../components/movement-form';
import { MovementSaved } from '../components/movement-saved';
import { formatRate } from '../format-rate';
import { impliedRatePreview, type ImpliedRatePreviewInput } from '../implied-rate-preview';
import { movementFailureErrors, type MovementFormErrors } from '../movement-form-errors';
import { buildMovementRequest } from '../movement-request';
import { TagInputContainer } from './tag-input-container';

/** The API's largest page; the container keeps asking until `total` is reached. */
const PAGE_SIZE = 100;
const HOUR_MS = 60 * 60 * 1000;

interface ScreenData {
  accounts: AccountResponse[];
  categories: CategoryResponse[];
  timeZone: string;
  rateType: RateType;
  /** The default rate type's stored sell price, formatted for the locale; empty without one. */
  defaultRate: string;
  rateAgeHours: number | undefined;
  defaultOccurredAt: string;
}

type ScreenState = AccountsLoadState | { kind: 'ready'; data: ScreenData };

/** Reads every page of a list, 100 at a time; an empty page ends the loop even on a stale total. */
async function loadAll<T>(
  fetchPage: (offset: number) => Promise<ApiResult<{ items: T[]; total: number }>>,
): Promise<ApiResult<T[]>> {
  const items: T[] = [];
  for (;;) {
    const page = await fetchPage(items.length);
    if (!page.ok) return page;
    items.push(...page.data.items);
    if (page.data.items.length === 0 || items.length >= page.data.total) {
      return { ok: true, data: items };
    }
  }
}

/** What the saved view shows: the rate the API stored, if the movement has one. */
interface SavedMovement {
  rate: string | undefined;
  implied: boolean;
}

export function CreateMovementContainer() {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const language: CategoryLanguage = locale === 'en' ? 'en' : 'es';
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<MovementFormErrors>({});
  const [saved, setSaved] = useState<SavedMovement | undefined>();
  // Bumped on every save: remounts the form so the next movement starts from a clean one.
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    let active = true;
    // A function, not the variable: TypeScript would narrow `active` to `true` across the awaits.
    const isActive = () => active;
    void (async () => {
      const [profile, accounts, categories, rates] = await Promise.all([
        api.getProfile(),
        loadAll((offset) =>
          api.listAccounts({
            archived: false,
            limit: PAGE_SIZE,
            ...(offset > 0 ? { offset } : {}),
          }),
        ),
        loadAll((offset) =>
          api.listCategories({
            archived: false,
            limit: PAGE_SIZE,
            ...(offset > 0 ? { offset } : {}),
          }),
        ),
        api.getLatestRates(),
      ]);
      if (!isActive()) return;
      for (const result of [profile, accounts, categories, rates]) {
        if (!result.ok && result.code === 'UNAUTHENTICATED') {
          router.replace('/sign-in');
          return;
        }
      }
      if (!profile.ok) {
        setState({ kind: 'failed', error: profile.messageKey });
        return;
      }
      if (!accounts.ok) {
        setState({ kind: 'failed', error: accounts.messageKey });
        return;
      }
      if (!categories.ok) {
        setState({ kind: 'failed', error: categories.messageKey });
        return;
      }

      const { timeZone, defaultRateType } = profile.data.preferences;
      const now = new Date();
      // Without readable rates the screen still works: the rate is then empty and required.
      const stored = rates.ok
        ? rates.data.rates.find((entry) => entry.rateType === defaultRateType)
        : undefined;
      const age = stored === undefined ? 0 : rateAgeMs(stored, now);
      setState({
        kind: 'ready',
        data: {
          accounts: accounts.data,
          categories: categories.data,
          timeZone,
          rateType: defaultRateType,
          defaultRate: stored === undefined ? '' : formatRateInput(BigInt(stored.sell), locale),
          rateAgeHours: age > RATE_AGE_WARNING_MS ? Math.floor(age / HOUR_MS) : undefined,
          defaultOccurredAt: instantToZonedLocal(now, timeZone),
        },
      });
    })();
    return () => {
      active = false;
    };
  }, [api, router, locale, attempt]);

  async function create(values: MovementFormValues, data: ScreenData) {
    if (pending) return;
    const { request, fields } = buildMovementRequest(values, {
      accounts: data.accounts,
      categories: data.categories,
      timeZone: data.timeZone,
      locale,
      now: new Date(),
      defaultRate: data.defaultRate,
    });
    if (request === undefined) {
      setErrors({ fields });
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.createMovement(request);
    if (result.ok) {
      const { rate, rateSource } = result.data;
      const implied = rateSource === 'implied';
      setSaved({
        rate: rate === null ? undefined : formatRate(BigInt(rate), locale, implied ? 4 : 2),
        implied,
      });
      setFormKey((current) => current + 1);
      setPending(false);
      // The notice sits above the form, which may have been scrolled well past it.
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setPending(false);
    if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    // Every other failure keeps the form mounted, so what the user typed stays for a retry.
    else setErrors(movementFailureErrors(result));
  }

  if (state.kind !== 'ready') {
    return (
      <AccountsLoadStateView
        state={state}
        onRetry={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }

  const { data } = state;
  return (
    <div className="grid gap-4">
      {saved === undefined ? null : <MovementSaved rate={saved.rate} implied={saved.implied} />}
      <MovementForm
        key={formKey}
        accounts={data.accounts.filter((item) => !item.archived)}
        categories={data.categories
          .filter((item) => !item.archived)
          .map((item) => ({ id: item.id, kind: item.kind, label: categoryLabel(item, language) }))}
        defaultOccurredAt={data.defaultOccurredAt}
        defaultRate={data.defaultRate}
        rateType={data.defaultRate === '' ? undefined : data.rateType}
        rateAgeHours={data.rateAgeHours}
        pending={pending}
        errors={errors}
        previewRate={(input: ImpliedRatePreviewInput) =>
          impliedRatePreview(input, data.accounts, locale)
        }
        renderTagField={({ value, onChange, error }) => (
          <TagInputContainer value={value} onChange={onChange} error={error} />
        )}
        onSubmit={(values) => {
          void create(values, data);
        }}
      />
    </div>
  );
}
