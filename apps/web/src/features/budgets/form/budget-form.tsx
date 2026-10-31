'use client';

import { ACCOUNT_CURRENCIES, BUDGET_NAME_MAX_LENGTH } from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode, type SubmitEvent } from 'react';
import { FormActions } from '@/components/ui/form';
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
import type {
  BudgetFieldErrors,
  BudgetFieldName,
  BudgetFormState,
} from '../helpers/budget-request';
import { addThreshold, type ThresholdError } from '../helpers/budget-thresholds';
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
  /** Called whenever the user changes a value, so a result shown for the last save can go away. */
  onEdit?: () => void;
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
  onEdit,
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

  // What is typed in the threshold input but not added yet; a save commits it.
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<ThresholdError | undefined>();
  // Fields the user edited since `errors` last arrived; their messages are hidden.
  const [cleared, setCleared] = useState<{
    source: BudgetFieldErrors | undefined;
    names: BudgetFieldName[];
  }>({ source: undefined, names: [] });

  const fieldErrors: BudgetFieldErrors = {};
  for (const [name, message] of Object.entries(errors.fields ?? {}) as [
    BudgetFieldName,
    BudgetFieldErrors[BudgetFieldName],
  ][]) {
    if (cleared.source === errors.fields && cleared.names.includes(name)) continue;
    fieldErrors[name] = message;
  }

  // After a failed submit, focus the first invalid field so its message is announced with it.
  useEffect(() => {
    if (!errors.fields && !draftError) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors, draftError]);

  function touch(field?: BudgetFieldName) {
    onEdit?.();
    if (field === undefined) return;
    setCleared((current) => ({
      source: errors.fields,
      names: [...(current.source === errors.fields ? current.names : []), field],
    }));
  }

  function update(changes: Partial<BudgetFormState>, field?: BudgetFieldName) {
    touch(field);
    setState((current) => ({ ...current, ...changes }));
  }

  function changeThresholds(thresholds: number[]) {
    setDraftError(undefined);
    update({ thresholds }, 'thresholds');
  }

  function addDraft() {
    const result = addThreshold(state.thresholds, draft);
    if (result.error !== undefined) {
      setDraftError(result.error);
      return;
    }
    setDraft('');
    changeThresholds(result.list);
  }

  function toggleCategory(id: string) {
    touch('categoryIds');
    setState((current) => ({
      ...current,
      categoryIds: current.categoryIds.includes(id)
        ? current.categoryIds.filter((item) => item !== id)
        : [...current.categoryIds, id],
    }));
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    let values = state;
    // A threshold typed but not added would be dropped silently: commit it, or say why not.
    if (draft.trim() !== '') {
      const result = addThreshold(state.thresholds, draft);
      if (result.error !== undefined) {
        setDraftError(result.error);
        return;
      }
      values = { ...state, thresholds: result.list };
      setState(values);
      setDraft('');
    }
    onSubmit(values);
  }

  const unchanged = draft.trim() === '' && (isUnchanged?.(state) ?? false);
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
          <MovementField label={t('name')} error={fieldErrors.name}>
            {(control) => (
              <Input
                name="name"
                autoComplete="off"
                defaultValue={initial?.name}
                maxLength={BUDGET_NAME_MAX_LENGTH * 2}
                onChange={(event) => {
                  update({ name: event.currentTarget.value }, 'name');
                }}
                {...control}
              />
            )}
          </MovementField>
          <MovementField label={t('amount')} error={fieldErrors.amount}>
            {(control) => (
              <MoneyInput
                name="amount"
                defaultValue={initial?.amount}
                onChange={(event) => {
                  update({ amount: event.currentTarget.value }, 'amount');
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
            error={fieldErrors.categoryIds}
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
            error={draftError ?? fieldErrors.thresholds}
            draft={draft}
            onDraftChange={(text) => {
              setDraft(text);
              setDraftError(undefined);
            }}
            onAdd={addDraft}
            onChange={changeThresholds}
          />
          {mode === 'edit' ? (
            <p className="text-small text-muted-foreground">{t('editNote')}</p>
          ) : null}
          <FormActions>
            <Button type="submit" disabled={disabled}>
              {pending ? t('saving') : t('submit')}
            </Button>
            <Link href={cancelHref} className={buttonVariants({ variant: 'ghost' })}>
              {t('cancel')}
            </Link>
          </FormActions>
        </form>
      </CardContent>
    </Card>
  );
}
