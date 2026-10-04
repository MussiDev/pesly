'use client';

import { type CategoryLanguage } from '@pesly/shared';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { AccountsLoadStateView } from '@/features/accounts/components/accounts-load-state';
import { categoryLabel } from '@/features/categories/category-display';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { MovementForm, type MovementFormValues } from '../components/movement-form';
import { MovementSaved } from '../components/movement-saved';
import { formatRate } from '../format-rate';
import { impliedRatePreview, type ImpliedRatePreviewInput } from '../implied-rate-preview';
import { movementFailureErrors, type MovementFormErrors } from '../movement-form-errors';
import { buildMovementRequest } from '../movement-request';
import { useMovementFormData, type MovementFormData } from '../use-movement-form-data';
import { TagInputContainer } from './tag-input-container';

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
  const { state, retry } = useMovementFormData();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<MovementFormErrors>({});
  const [saved, setSaved] = useState<SavedMovement | undefined>();
  // Bumped on every save: remounts the form so the next movement starts from a clean one.
  const [formKey, setFormKey] = useState(0);

  async function create(values: MovementFormValues, data: MovementFormData) {
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
    return <AccountsLoadStateView state={state} onRetry={retry} />;
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
