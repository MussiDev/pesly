'use client';

import { MOVEMENT_TYPES, type MovementType, type RateType } from '@pesly/shared';
import { CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SubmitEvent,
} from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Select } from '@/components/ui/select';
import { useCompactViewport } from '@/lib/use-compact-viewport';
import { FormAlert } from '@/features/auth/components/form-alert';
import { readField } from '@/features/auth/read-field';
import { Link } from '@/i18n/navigation';
import { applyKey, writeLikeTyping } from '../keypad-input';
import type { ImpliedRatePreview, ImpliedRatePreviewInput } from '../implied-rate-preview';
import type { MovementFieldMessage, MovementFormErrors } from '../movement-form-errors';
import { MovementField } from './movement-field';
import { NumericKeypad } from './numeric-keypad';
import { RateField } from './rate-field';
import { TypePills } from './type-pills';

/** What the user typed or picked, untouched: the container parses and validates it. */
export interface MovementFormValues {
  type: string;
  accountId: string;
  categoryId: string;
  amount: string;
  /** `YYYY-MM-DDTHH:mm`, the wall-clock time in the user's time zone. */
  occurredAt: string;
  rate: string;
  /** `true` once the user typed in the rate field, even if the text ended up the same. */
  rateEdited: boolean;
  note: string;
  /** Only present for a transfer or an exchange. */
  destinationAccountId?: string;
  /** Only present for an exchange: the amount that enters the destination account. */
  destinationAmount?: string;
  /** The chosen tags, as the tag field spelled them; only for an expense or income, empty when none. */
  tags?: string[];
}

/** The values an edit starts from: what the form shows before the user touches anything. */
export type MovementFormInitialValues = Omit<MovementFormValues, 'rateEdited'>;

/** What the tag slot receives: the form owns the chosen tags, the slot renders the field. */
export interface TagFieldControl {
  value: string[];
  onChange: (value: string[]) => void;
  error: MovementFieldMessage | undefined;
}

export interface MovementAccountOption {
  id: string;
  name: string;
  currency: string;
}

export interface MovementCategoryOption {
  id: string;
  kind: MovementType;
  label: string;
}

export interface MovementFormProps {
  accounts: readonly MovementAccountOption[];
  /** Usable (non-archived) categories of both types; the form shows the ones of the chosen type. */
  categories: readonly MovementCategoryOption[];
  defaultOccurredAt: string;
  defaultRate: string;
  rateType: RateType | undefined;
  rateAgeHours: number | undefined;
  pending: boolean;
  errors: MovementFormErrors;
  /** Display-only implied rate of an exchange for what is typed so far, computed by the container. */
  previewRate?: (input: ImpliedRatePreviewInput) => ImpliedRatePreview;
  /** Renders the tag field; the screen's container supplies it so the form stays presentational. */
  renderTagField?: (control: TagFieldControl) => ReactNode;
  /** `edit` fills the form from `initialValues`, locks the type and keeps the stored rate until edited. */
  mode?: 'create' | 'edit';
  /** The type a new movement opens on, e.g. from a quick action; edit mode keeps the stored type. */
  initialType?: MovementType;
  initialValues?: MovementFormInitialValues;
  onSubmit: (values: MovementFormValues) => void;
}

function toMovementType(value: string): MovementType {
  return MOVEMENT_TYPES.find((type) => type === value) ?? 'expense';
}

export function MovementForm({
  accounts,
  categories,
  defaultOccurredAt,
  defaultRate,
  rateType,
  rateAgeHours,
  pending,
  errors,
  previewRate,
  renderTagField,
  mode = 'create',
  initialType,
  initialValues,
  onSubmit,
}: MovementFormProps) {
  const t = useTranslations('movements');
  const locale = useLocale();
  const compact = useCompactViewport();
  const formRef = useRef<HTMLFormElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const destinationAmountRef = useRef<HTMLInputElement>(null);
  // The keypad types into the amount that was touched last; the first one until another is.
  const activeAmountRef = useRef<'amount' | 'destinationAmount'>('amount');
  const [type, setType] = useState<MovementType>(
    toMovementType(initialValues?.type ?? initialType ?? 'expense'),
  );
  const [rateEdited, setRateEdited] = useState(false);
  const [sourceId, setSourceId] = useState(initialValues?.accountId ?? '');
  const [destinationId, setDestinationId] = useState(initialValues?.destinationAccountId ?? '');
  const [amount, setAmount] = useState(initialValues?.amount ?? '');
  const [destinationAmount, setDestinationAmount] = useState(
    initialValues?.destinationAmount ?? '',
  );
  const categorized = type === 'expense' || type === 'income';
  const source = accounts.find((account) => account.id === sourceId);
  const destinations = destinationsFor(type, source, accounts);
  const showDestinationHint =
    !categorized &&
    (source === undefined ? !hasDestinationPair(type, accounts) : destinations.length === 0);
  const [tags, setTags] = useState<string[]>(initialValues?.tags ?? []);

  // After a failed submit, focus the first invalid field so its message is announced with it.
  useEffect(() => {
    if (!errors.fields) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  function pressKey(key: string) {
    const input =
      activeAmountRef.current === 'destinationAmount' && type === 'exchange'
        ? destinationAmountRef.current
        : amountRef.current;
    if (input === null) return;
    writeLikeTyping(input, applyKey(input.value, key, locale === 'en' ? '.' : ','));
  }

  function handleTypeChange(next: MovementType) {
    setType(next);
    setDestinationId('');
    // The rate field is unmounted for a transfer or an exchange, so its edit flag must not outlive it.
    if (next !== 'expense' && next !== 'income') setRateEdited(false);
  }

  function handleSourceChange(event: ChangeEvent<HTMLSelectElement>) {
    setSourceId(event.currentTarget.value);
    setDestinationId('');
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    onSubmit({
      type,
      accountId: readField(form, 'accountId'),
      categoryId: readField(form, 'categoryId'),
      amount: readField(form, 'amount'),
      occurredAt: readField(form, 'occurredAt'),
      rate: readField(form, 'rate'),
      rateEdited,
      note: readField(form, 'note'),
      ...(categorized ? {} : { destinationAccountId: readField(form, 'destinationAccountId') }),
      ...(type === 'exchange' ? { destinationAmount: readField(form, 'destinationAmount') } : {}),
      ...(categorized ? { tags } : {}),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1">{t(mode === 'edit' ? 'edit.title' : 'new.title')}</CardTitle>
        <CardDescription>
          {t(mode === 'edit' ? 'edit.description' : 'new.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form ref={formRef} className="grid gap-4" noValidate onSubmit={handleSubmit}>
          <FormAlert error={errors.form} />
          <RateLimitAlert rateLimit={errors.rateLimit} />
          <TypePills value={type} disabled={mode === 'edit'} onChange={handleTypeChange} />
          <MovementField
            label={type === 'exchange' ? t('fields.amountOut') : t('fields.amount')}
            error={errors.fields?.amount}
          >
            {(control) => (
              <MoneyInput
                ref={amountRef}
                name="amount"
                defaultValue={initialValues?.amount}
                required
                keyboard={compact ? 'none' : 'default'}
                className="h-14 text-center text-title font-bold"
                placeholder="0"
                onFocus={() => {
                  activeAmountRef.current = 'amount';
                }}
                onChange={(event) => {
                  setAmount(event.currentTarget.value);
                }}
                {...control}
              />
            )}
          </MovementField>
          {type === 'exchange' ? (
            <>
              <MovementField label={t('fields.amountIn')} error={errors.fields?.destinationAmount}>
                {(control) => (
                  <MoneyInput
                    ref={destinationAmountRef}
                    name="destinationAmount"
                    defaultValue={initialValues?.destinationAmount}
                    required
                    keyboard={compact ? 'none' : 'default'}
                    className="h-14 text-center text-title font-bold"
                    placeholder="0"
                    onFocus={() => {
                      activeAmountRef.current = 'destinationAmount';
                    }}
                    onChange={(event) => {
                      setDestinationAmount(event.currentTarget.value);
                    }}
                    {...control}
                  />
                )}
              </MovementField>
              {previewRate === undefined ? null : (
                <ImpliedRateLine
                  preview={previewRate({
                    accountId: sourceId,
                    destinationAccountId: destinationId,
                    amount,
                    destinationAmount,
                  })}
                />
              )}
            </>
          ) : null}
          <NumericKeypad onKey={pressKey} />
          <MovementField label={t('fields.account')} error={errors.fields?.account}>
            {(control) => (
              <Select
                name="accountId"
                defaultValue={initialValues?.accountId ?? ''}
                required
                onChange={handleSourceChange}
                {...control}
              >
                <option value="">{t('fields.accountPlaceholder')}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {`${account.name} (${account.currency})`}
                  </option>
                ))}
              </Select>
            )}
          </MovementField>
          {categorized ? null : (
            <MovementField
              label={t('fields.destinationAccount')}
              hint={
                showDestinationHint
                  ? t(
                      type === 'transfer'
                        ? 'fields.destinationHintTransfer'
                        : 'fields.destinationHintExchange',
                    )
                  : undefined
              }
              error={errors.fields?.destinationAccount}
            >
              {(control) => (
                // Keyed by type and source so the picked destination resets when either changes.
                <Select
                  key={`${type}:${sourceId}`}
                  name="destinationAccountId"
                  // The stored destination only fits the stored source; another source starts empty.
                  defaultValue={
                    sourceId === initialValues?.accountId
                      ? (initialValues.destinationAccountId ?? '')
                      : ''
                  }
                  required
                  onChange={(event) => {
                    setDestinationId(event.currentTarget.value);
                  }}
                  {...control}
                >
                  <option value="">{t('fields.destinationAccountPlaceholder')}</option>
                  {destinations.map((account) => (
                    <option key={account.id} value={account.id}>
                      {`${account.name} (${account.currency})`}
                    </option>
                  ))}
                </Select>
              )}
            </MovementField>
          )}
          {categorized ? (
            <MovementField label={t('fields.category')} error={errors.fields?.category}>
              {(control) => (
                // Keyed by type so the picked category resets when the type changes.
                <Select
                  key={type}
                  name="categoryId"
                  defaultValue={initialValues?.categoryId ?? ''}
                  required
                  {...control}
                >
                  <option value="">{t('fields.categoryPlaceholder')}</option>
                  {categories
                    .filter((category) => category.kind === type)
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                </Select>
              )}
            </MovementField>
          ) : null}
          <MovementField label={t('fields.occurredAt')} error={errors.fields?.occurredAt}>
            {(control) => (
              <Input
                name="occurredAt"
                type="datetime-local"
                defaultValue={initialValues?.occurredAt ?? defaultOccurredAt}
                required
                {...control}
              />
            )}
          </MovementField>
          {categorized ? (
            <RateField
              defaultValue={initialValues?.rate ?? defaultRate}
              kept={mode === 'edit'}
              rateType={rateType}
              ageHours={rateAgeHours}
              error={errors.fields?.rate}
              onEdited={() => {
                setRateEdited(true);
              }}
            />
          ) : null}
          <MovementField label={t('fields.note')} error={errors.fields?.note}>
            {(control) => (
              <Input
                name="note"
                type="text"
                autoComplete="off"
                defaultValue={initialValues?.note}
                {...control}
              />
            )}
          </MovementField>
          {categorized
            ? renderTagField?.({ value: tags, onChange: setTags, error: errors.fields?.tags })
            : null}
          <Button type="submit" size="lg" disabled={pending} className="h-14 text-body font-bold">
            {pending ? t('form.pending') : t(mode === 'edit' ? 'form.save' : 'form.submit')}
          </Button>
          <Link href="/movements" className={buttonVariants({ variant: 'ghost' })}>
            {t('form.back')}
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}

/** The destinations a source allows: another account of the same currency, or of the other one. */
function destinationsFor(
  type: MovementType,
  source: MovementAccountOption | undefined,
  accounts: readonly MovementAccountOption[],
): MovementAccountOption[] {
  if (source === undefined || (type !== 'transfer' && type !== 'exchange')) return [];
  return accounts.filter(
    (account) =>
      account.id !== source.id &&
      (type === 'transfer'
        ? account.currency === source.currency
        : account.currency !== source.currency),
  );
}

/** Whether any account can be the source of a movement that has a destination. */
function hasDestinationPair(
  type: MovementType,
  accounts: readonly MovementAccountOption[],
): boolean {
  return accounts.some((account) => destinationsFor(type, account, accounts).length > 0);
}

function ImpliedRateLine({ preview }: { preview: ImpliedRatePreview }) {
  const t = useTranslations('movements.exchange');
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {preview.kind === 'rate'
        ? t('impliedRate', { rate: preview.text })
        : preview.kind === 'empty'
          ? t('impliedRateEmpty')
          : t('impliedRateOutOfRange')}
    </p>
  );
}

function RateLimitAlert({ rateLimit }: { rateLimit: MovementFormErrors['rateLimit'] }) {
  const t = useTranslations('movements.errors');
  if (!rateLimit) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>
        {rateLimit.seconds === undefined
          ? t('rateLimitedGeneric')
          : t('rateLimited', { seconds: rateLimit.seconds })}
      </AlertDescription>
    </Alert>
  );
}
