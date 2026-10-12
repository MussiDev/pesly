'use client';

import { ACCOUNT_CURRENCIES, BUDGET_NAME_MAX_LENGTH } from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode, type SubmitEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Select } from '@/components/ui/select';
import { MovementField } from '@/features/movements/components/movement-field';
import { Link } from '@/i18n/navigation';
import { defaultThresholds } from '../helpers/budget-request';
import type { BudgetFieldErrors, BudgetFormState } from '../helpers/budget-request';
import { BudgetCategoryPicker } from './budget-category-picker';
import { BudgetThresholdsEditor } from './budget-thresholds-editor';
import type { BudgetCategoriesState } from './use-budget-categories';

export interface BudgetFormErrors {
  fields?: BudgetFieldErrors;
  /** A full catalog path. */
  form?: string;
}

interface BudgetFormProps {
  mode: 'create' | 'edit';
  /** The values to start from; `amount` is already formatted for the locale. */
  initial?: BudgetFormState;
  /** Edit mode shows the currency here instead of a control. */
  readOnly?: ReactNode;
  categories: BudgetCategoriesState;
  onRetryCategories: () => void;
  pending: boolean;
  errors: BudgetFormErrors;
  cancelHref: string;
  /** Edit mode: true while the current values equal the saved ones, which disables the save. */
  isUnchanged?: (state: BudgetFormState) => boolean;
  onSubmit: (state: BudgetFormState) => void;
}

/** Name, amount, categories, rollover and thresholds, plus the currency when creating. */
export function BudgetForm({
  mode,
  initial,
  readOnly,
  categories,
  onRetryCategories,
  pending,
  errors,
  cancelHref,
  isUnchanged,
  onSubmit,
}: BudgetFormProps) {
  const t = useTranslations('budgets.form');
  const tAll = useTranslations();
  const formRef = useRef<HTMLFormElement>(null);
  const rolloverId = useId();
  const [state, setState] = useState<BudgetFormState>(
    initial ?? {
      name: '',
      amount: '',
      currency: 'ARS',
      categoryIds: [],
      rollover: false,
      thresholds: defaultThresholds(),
    },
  );

  // After a failed submit, focus the first invalid field so its message is announced with it.
  useEffect(() => {
    if (!errors.fields) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  function update(changes: Partial<BudgetFormState>) {
    setState((current) => ({ ...current, ...changes }));
  }

  function toggleCategory(id: string) {
    setState((current) => ({
      ...current,
      categoryIds: current.categoryIds.includes(id)
        ? current.categoryIds.filter((item) => item !== id)
        : [...current.categoryIds, id],
    }));
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(state);
  }

  const unchanged = isUnchanged?.(state) ?? false;
  const disabled = pending || categories.kind !== 'ready' || unchanged;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{mode === 'create' ? t('createTitle') : t('editTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form ref={formRef} noValidate onSubmit={handleSubmit} className="grid gap-4">
          {errors.form ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{tAll(errors.form)}</AlertDescription>
            </Alert>
          ) : null}
          <MovementField label={t('name')} error={errors.fields?.name}>
            {(control) => (
              <Input
                name="name"
                autoComplete="off"
                defaultValue={initial?.name}
                maxLength={BUDGET_NAME_MAX_LENGTH * 2}
                onChange={(event) => {
                  update({ name: event.currentTarget.value });
                }}
                {...control}
              />
            )}
          </MovementField>
          <MovementField label={t('amount')} error={errors.fields?.amount}>
            {(control) => (
              <MoneyInput
                name="amount"
                defaultValue={initial?.amount}
                onChange={(event) => {
                  update({ amount: event.currentTarget.value });
                }}
                {...control}
              />
            )}
          </MovementField>
          {mode === 'create' ? (
            <MovementField label={t('currency')} error={undefined}>
              {(control) => (
                <Select
                  name="currency"
                  value={state.currency}
                  onChange={(event) => {
                    update({ currency: event.currentTarget.value as BudgetFormState['currency'] });
                  }}
                  {...control}
                >
                  {ACCOUNT_CURRENCIES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              )}
            </MovementField>
          ) : (
            readOnly
          )}
          <BudgetCategoryPicker
            categories={categories}
            selected={state.categoryIds}
            error={errors.fields?.categoryIds}
            onToggle={toggleCategory}
            onRetry={onRetryCategories}
          />
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox
              id={rolloverId}
              checked={state.rollover}
              onChange={(event) => {
                update({ rollover: event.currentTarget.checked });
              }}
            />
            <Label htmlFor={rolloverId}>{t('rollover')}</Label>
          </div>
          <BudgetThresholdsEditor
            thresholds={state.thresholds}
            error={errors.fields?.thresholds}
            onChange={(thresholds) => {
              update({ thresholds });
            }}
          />
          {mode === 'edit' ? (
            <p className="text-small text-muted-foreground">{t('editNote')}</p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={disabled}>
              {pending ? t('saving') : t('submit')}
            </Button>
            <Link href={cancelHref} className={buttonVariants({ variant: 'ghost' })}>
              {t('cancel')}
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
