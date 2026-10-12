'use client';

import { useLocale } from 'next-intl';
import { useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useApiClient } from '@/lib/api-client-provider';
import { buildCreateBudget, type BudgetFormState } from '../helpers/budget-request';
import { BudgetForm, type BudgetFormErrors } from './budget-form';
import { formFailureMessage } from './form-failure';
import { useBudgetCategories } from './use-budget-categories';

/** The new budget screen: one request to load the categories, one to save. */
export function CreateBudgetContainer() {
  const api = useApiClient();
  const router = useRouter();
  const locale = useLocale();
  const sending = useRef(false);
  const categories = useBudgetCategories(true);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<BudgetFormErrors>({});

  async function save(state: BudgetFormState) {
    if (sending.current) return;
    const built = buildCreateBudget(state, locale);
    if (built.request === undefined) {
      setErrors({ fields: built.errors });
      return;
    }
    sending.current = true;
    setPending(true);
    setErrors({});
    const result = await api.createBudget(built.request);
    if (result.ok) {
      router.push('/budgets');
      return;
    }
    sending.current = false;
    setPending(false);
    if (result.code === 'UNAUTHENTICATED') router.replace('/sign-in');
    // The form stays mounted, so everything the user entered is still there for a retry.
    else setErrors({ form: formFailureMessage(result) });
  }

  return (
    <BudgetForm
      mode="create"
      categories={categories.state}
      onRetryCategories={categories.retry}
      pending={pending}
      errors={errors}
      cancelHref="/budgets"
      onSubmit={(state) => {
        void save(state);
      }}
    />
  );
}
