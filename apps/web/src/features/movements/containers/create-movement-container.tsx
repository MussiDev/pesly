'use client';

import {
  MOVEMENT_AMOUNT_MAX_MINOR_UNITS,
  MOVEMENT_TYPES,
  RATE_AGE_WARNING_MS,
  dateInTimeZone,
  formatMinorUnitsString,
  instantToZonedLocal,
  movementNoteSchema,
  occurredAtSchema,
  parseAmountInput,
  parseRateInput,
  rateAgeMs,
  formatRateInput,
  todayInTimeZone,
  zonedLocalToInstant,
  type AccountResponse,
  type CategoryLanguage,
  type CategoryResponse,
  type MovementType,
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
import type { ApiResult, CreateMovementInput } from '@/lib/api-client';
import { useApiClient } from '@/lib/api-client-provider';
import { MovementForm, type MovementFormValues } from '../components/movement-form';
import { MovementSaved } from '../components/movement-saved';
import { formatRate } from '../format-rate';
import {
  movementFailureErrors,
  type MovementFieldMessage,
  type MovementFieldName,
  type MovementFormErrors,
} from '../movement-form-errors';

/** The API's largest page; the container keeps asking until `total` is reached. */
const PAGE_SIZE = 100;
const HOUR_MS = 60 * 60 * 1000;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

type FieldErrors = Partial<Record<MovementFieldName, MovementFieldMessage>>;

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

function toMovementType(value: string): MovementType | undefined {
  return MOVEMENT_TYPES.find((type) => type === value);
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
  const [savedRate, setSavedRate] = useState<string | undefined>();
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

  /** The request to send, or the per-field messages explaining why there is none. */
  function validate(
    values: MovementFormValues,
    data: ScreenData,
  ):
    | { request: CreateMovementInput; fields?: undefined }
    | { request?: undefined; fields: FieldErrors } {
    const fields: FieldErrors = {};
    const type = toMovementType(values.type);

    const account = data.accounts.find((item) => item.id === values.accountId && !item.archived);
    if (account === undefined) fields.account = 'movements.errors.accountRequired';

    const category = data.categories.find(
      (item) => item.id === values.categoryId && !item.archived && item.kind === type,
    );
    if (category === undefined) fields.category = 'movements.errors.categoryRequired';

    const amount = parseAmountInput(values.amount, locale);
    if (amount === null) fields.amount = 'movements.errors.amountInvalid';
    else if (amount <= 0n) fields.amount = 'movements.errors.amountNotPositive';
    else if (amount > MOVEMENT_AMOUNT_MAX_MINOR_UNITS) {
      fields.amount = 'movements.errors.amountOutOfRange';
    }

    let occurredAt: string | undefined;
    if (!LOCAL_DATE_TIME.test(values.occurredAt)) {
      fields.occurredAt = 'movements.errors.dateInvalid';
    } else {
      const instant = zonedLocalToInstant(values.occurredAt, data.timeZone);
      if (instant === null) fields.occurredAt = 'movements.errors.dateSkipped';
      else if (
        dateInTimeZone(instant, data.timeZone) > todayInTimeZone(new Date(), data.timeZone)
      ) {
        fields.occurredAt = 'errors.movementDateInFuture';
      } else if (!occurredAtSchema.safeParse(instant.toISOString()).success) {
        fields.occurredAt = 'movements.errors.dateInvalid';
      } else occurredAt = instant.toISOString();
    }

    let rate: CreateMovementInput['rate'] | undefined;
    if (!values.rateEdited && data.defaultRate !== '') {
      rate = { source: 'automatic' };
    } else if (values.rate.trim() === '') {
      fields.rate = 'movements.errors.rateRequired';
    } else {
      const scaled = parseRateInput(values.rate, locale);
      if (scaled === null) fields.rate = 'movements.errors.rateInvalid';
      else rate = { source: 'manual', value: scaled.toString() };
    }

    const note = movementNoteSchema.safeParse(values.note);
    if (!note.success) {
      fields.note = CONTROL_OR_FORMAT.test(values.note)
        ? 'movements.errors.noteInvalidCharacters'
        : 'movements.errors.noteTooLong';
    }

    if (
      Object.keys(fields).length > 0 ||
      type === undefined ||
      account === undefined ||
      category === undefined ||
      amount === null ||
      occurredAt === undefined ||
      rate === undefined ||
      !note.success
    ) {
      return { fields };
    }
    return {
      request: {
        type,
        accountId: account.id,
        categoryId: category.id,
        amount: formatMinorUnitsString(amount),
        occurredAt,
        ...(note.data === undefined ? {} : { note: note.data }),
        rate,
      },
    };
  }

  async function create(values: MovementFormValues, data: ScreenData) {
    if (pending) return;
    const { request, fields } = validate(values, data);
    if (request === undefined) {
      setErrors({ fields });
      return;
    }
    setPending(true);
    setErrors({});
    const result = await api.createMovement(request);
    if (result.ok) {
      setSavedRate(formatRate(BigInt(result.data.rate), locale));
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
      {savedRate === undefined ? null : <MovementSaved rate={savedRate} />}
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
        onSubmit={(values) => {
          void create(values, data);
        }}
      />
    </div>
  );
}
