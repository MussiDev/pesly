// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import es from '../messages/es.json';
import { formatRate } from '../src/features/movements/format-rate';
import {
  movementFailureErrors,
  type MovementFormErrors,
} from '../src/features/movements/movement-form-errors';
import {
  MovementForm,
  type MovementFormProps,
  type MovementFormValues,
} from '../src/features/movements/components/movement-form';
import { RateField } from '../src/features/movements/components/rate-field';
import {
  MovementList,
  type MovementListItem,
} from '../src/features/movements/components/movement-list';
import { dayKey, formatDay } from '../src/features/movements/components/movement-row';
import { MovementSaved } from '../src/features/movements/components/movement-saved';
import { MovementsLoadStateView } from '../src/features/movements/components/movements-load-state';
import type { ApiFailure } from '../src/lib/api-client';

afterEach(cleanup);

const CATALOGS = { es, en } as const;

function renderIntl(ui: ReactElement, locale: 'es' | 'en' = 'es') {
  return render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={CATALOGS[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ACCOUNTS = [
  { id: 'a1', name: 'Caja', currency: 'ARS' },
  { id: 'a2', name: 'Dolares', currency: 'USD' },
];
const CATEGORIES = [
  { id: 'c1', kind: 'expense' as const, label: 'Comida' },
  { id: 'c2', kind: 'income' as const, label: 'Sueldo' },
  { id: 'c3', kind: 'expense' as const, label: 'Transporte' },
];

function form(overrides: Partial<MovementFormProps> = {}) {
  const onSubmit = vi.fn<(values: MovementFormValues) => void>();
  const props: MovementFormProps = {
    accounts: ACCOUNTS,
    categories: CATEGORIES,
    defaultOccurredAt: '2026-10-02T12:30',
    defaultRate: '1250,5',
    rateType: 'blue',
    rateAgeHours: undefined,
    pending: false,
    errors: {},
    onSubmit,
    ...overrides,
  };
  return { onSubmit, ...renderIntl(<MovementForm {...props} />) };
}

const label = (text: string) => screen.getByLabelText<HTMLInputElement>(text);

describe('MovementForm', () => {
  it('renders every field with an associated label and the translated title', () => {
    form();

    expect(screen.getByRole('heading', { level: 1, name: es.movements.new.title })).toBeDefined();
    for (const name of [
      es.movements.fields.type,
      es.movements.fields.account,
      es.movements.fields.category,
      es.movements.fields.amount,
      es.movements.fields.occurredAt,
      es.movements.fields.rate,
      es.movements.fields.note,
    ]) {
      expect(screen.getByLabelText(name)).toBeDefined();
    }
  });

  it('shows the date and time in a datetime-local control with the given default, editable (AC-31)', async () => {
    form();
    const field = label(es.movements.fields.occurredAt);

    expect(field.type).toBe('datetime-local');
    expect(field.value).toBe('2026-10-02T12:30');
    await userEvent.setup().clear(field);
    expect(field.value).toBe('');
  });

  it('lists only the categories of the chosen type and switches with the type (AC-03)', async () => {
    form();
    const category = () => screen.getByLabelText(es.movements.fields.category);
    const names = () =>
      within(category())
        .getAllByRole('option')
        .map((option) => option.textContent);

    expect(names()).toEqual([es.movements.fields.categoryPlaceholder, 'Comida', 'Transporte']);
    await userEvent.setup().selectOptions(label(es.movements.fields.type), 'income');

    expect(names()).toEqual([es.movements.fields.categoryPlaceholder, 'Sueldo']);
  });

  it('submits what was typed, untouched, with the rate flagged as not edited', async () => {
    const { onSubmit } = form();
    const user = userEvent.setup();

    await user.selectOptions(label(es.movements.fields.account), 'a1');
    await user.selectOptions(label(es.movements.fields.category), 'c1');
    await user.type(label(es.movements.fields.amount), '1.500,50');
    await user.type(label(es.movements.fields.note), 'Almuerzo');
    await user.click(screen.getByRole('button', { name: es.movements.form.submit }));

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'expense',
      accountId: 'a1',
      categoryId: 'c1',
      amount: '1.500,50',
      occurredAt: '2026-10-02T12:30',
      rate: '1250,5',
      rateEdited: false,
      note: 'Almuerzo',
    });
  });

  it('flags the rate as edited once the user types in it, even to the same value (AC-08)', async () => {
    const { onSubmit } = form();
    const user = userEvent.setup();
    const rate = label(es.movements.fields.rate);

    await user.type(rate, '0');
    await user.type(rate, '{Backspace}');
    await user.click(screen.getByRole('button', { name: es.movements.form.submit }));

    const [values] = onSubmit.mock.calls[0] ?? [];
    expect(values?.rate).toBe('1250,5');
    expect(values?.rateEdited).toBe(true);
  });

  it('ties each field error to its control and focuses the first invalid one (accessibility)', () => {
    const errors: MovementFormErrors = {
      fields: {
        account: 'movements.errors.accountRequired',
        amount: 'movements.errors.amountNotPositive',
      },
    };
    form({ errors });

    const account = label(es.movements.fields.account);
    const amount = label(es.movements.fields.amount);
    expect(account.getAttribute('aria-invalid')).toBe('true');
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(label(es.movements.fields.note).getAttribute('aria-invalid')).toBe('false');
    const message = document.getElementById(amount.getAttribute('aria-describedby') ?? '');
    expect(message?.textContent).toBe(es.movements.errors.amountNotPositive);
    expect(document.activeElement).toBe(account);
  });

  it('shows "Amount must be greater than 0" in English (AC-02)', () => {
    renderIntl(
      <MovementForm
        accounts={ACCOUNTS}
        categories={CATEGORIES}
        defaultOccurredAt="2026-10-02T12:30"
        defaultRate=""
        rateType={undefined}
        rateAgeHours={undefined}
        pending={false}
        errors={{ fields: { amount: 'movements.errors.amountNotPositive' } }}
        onSubmit={vi.fn()}
      />,
      'en',
    );

    expect(screen.getByText('Amount must be greater than 0')).toBeDefined();
  });

  it('shows the too-many-requests message with the seconds to wait, or without them', () => {
    const { unmount } = form({ errors: { rateLimit: { seconds: 42 } } });
    expect(screen.getByRole('alert').textContent).toContain('42');
    unmount();
    form({ errors: { rateLimit: {} } });
    expect(screen.getByRole('alert').textContent).toBe(es.movements.errors.rateLimitedGeneric);
  });

  it('disables the submit button while pending and shows the form-level error', () => {
    form({ pending: true, errors: { form: 'unexpected' } });

    expect(
      screen.getByRole('button', { name: es.movements.form.pending }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe(es.errors.unexpected);
  });
});

describe('RateField', () => {
  function rateField(props: Partial<Parameters<typeof RateField>[0]> = {}) {
    return renderIntl(
      <RateField
        defaultValue="1250,5"
        rateType="blue"
        ageHours={undefined}
        error={undefined}
        onEdited={vi.fn()}
        {...props}
      />,
    );
  }

  it('prefills the stored rate and says it is automatic', () => {
    rateField();

    expect(label(es.movements.fields.rate).value).toBe('1250,5');
    expect(
      screen.getByText(
        es.movements.rate.automatic.replace('{rateType}', es.profile.rateTypes.blue),
      ),
    ).toBeDefined();
    expect(label(es.movements.fields.rate).required).toBe(false);
  });

  it('is empty and required when no rate is stored (AC-20)', () => {
    rateField({ defaultValue: '', rateType: undefined });

    const field = label(es.movements.fields.rate);
    expect(field.value).toBe('');
    expect(field.required).toBe(true);
    expect(screen.getByText(es.movements.rate.missing)).toBeDefined();
  });

  it('shows "rate from 3 h ago" only when an age is given (AC-11)', () => {
    const { unmount } = rateField({ ageHours: 3 });
    expect(screen.getByRole('status').textContent).toBe(
      es.movements.rate.age.replace('{hours}', '3'),
    );
    unmount();
    rateField();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reports the first edit', async () => {
    const onEdited = vi.fn();
    rateField({ onEdited });

    await userEvent.setup().type(label(es.movements.fields.rate), '1');

    expect(onEdited).toHaveBeenCalled();
  });
});

describe('formatRate', () => {
  it.each([
    [12505000n, 'en', '1,250.50'],
    [12505000n, 'es', '1250,50'],
    [12505001n, 'en', '1,250.5001'],
    [10000n, 'en', '1.00'],
  ] as const)('formats %s in %s as %s without a float', (value, locale, expected) => {
    expect(formatRate(value, locale)).toBe(expected);
  });
});

describe('movementFailureErrors', () => {
  function failure(code: ApiFailure['code'], extra: Partial<ApiFailure> = {}): ApiFailure {
    return { ok: false, code, messageKey: 'unexpected', ...extra };
  }

  it.each([
    ['RATE_REQUIRED', 'rate', 'errors.rateRequired'],
    ['MOVEMENT_DATE_IN_FUTURE', 'occurredAt', 'errors.movementDateInFuture'],
    ['MOVEMENT_CATEGORY_KIND_MISMATCH', 'category', 'errors.movementCategoryKindMismatch'],
    ['CATEGORY_ARCHIVED', 'category', 'errors.categoryArchived'],
    ['ACCOUNT_ARCHIVED', 'account', 'movements.errors.accountArchived'],
  ] as const)('puts %s on the %s field', (code, field, message) => {
    expect(movementFailureErrors(failure(code))).toEqual({ fields: { [field]: message } });
  });

  it('keeps the movement wording apart from the account-archived wording of the global mapping', () => {
    const errors = movementFailureErrors(failure('ACCOUNT_ARCHIVED'));

    expect(errors.fields?.account).not.toBe('errors.accountArchived');
  });

  it('carries the seconds of a rate limit, or none when the header was missing', () => {
    expect(movementFailureErrors(failure('RATE_LIMITED', { retryAfterSeconds: 30 }))).toEqual({
      rateLimit: { seconds: 30 },
    });
    expect(movementFailureErrors(failure('RATE_LIMITED'))).toEqual({ rateLimit: {} });
  });

  it('shows any other failure as the generic form message', () => {
    expect(movementFailureErrors(failure('INTERNAL', { messageKey: 'unexpected' }))).toEqual({
      form: 'unexpected',
    });
    expect(movementFailureErrors(failure('NETWORK', { messageKey: 'network' }))).toEqual({
      form: 'network',
    });
  });
});

describe('MovementsLoadStateView (FEAT-004 AC-21)', () => {
  it('shows skeletons inside a labelled busy status while loading, with no list yet', () => {
    const { container } = renderIntl(
      <MovementsLoadStateView state={{ kind: 'loading' }} onRetry={vi.fn()} />,
    );

    const status = screen.getByRole('status');
    expect(status.textContent).toBe(es.app.loading);
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(1);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows the shared error state with the failure message and a working retry', async () => {
    const onRetry = vi.fn();
    const { container } = renderIntl(
      <MovementsLoadStateView state={{ kind: 'failed', error: 'network' }} onRetry={onRetry} />,
    );

    expect(container.querySelector('[data-slot="alert"]')).not.toBeNull();
    expect(screen.getByText(es.ui.error.title)).toBeDefined();
    expect(screen.getByText(es.errors.network)).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: es.app.retry }));

    expect(onRetry).toHaveBeenCalledOnce();
  });
});

function listItem(
  id: string,
  type: 'expense' | 'income',
  occurredAt: string,
  overrides: Partial<MovementListItem> = {},
): MovementListItem {
  return {
    movement: {
      id,
      type,
      accountId: 'a1',
      categoryId: 'c1',
      amount: '150050',
      occurredAt,
      note: null,
      rate: '12505000',
      rateSource: 'automatic',
      rateType: 'blue',
      createdAt: occurredAt,
    },
    accountName: 'Caja',
    currency: 'ARS',
    categoryName: 'Comida',
    ...overrides,
  };
}

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

function list(items: readonly MovementListItem[]) {
  return renderIntl(
    <MovementList
      items={items}
      timeZone={BUENOS_AIRES}
      hasMore={false}
      loadingMore={false}
      moreError={undefined}
      onShowMore={vi.fn()}
    />,
  );
}

function dayHeading(iso: string): string {
  return new Intl.DateTimeFormat('es', { dateStyle: 'full', timeZone: BUENOS_AIRES }).format(
    new Date(iso),
  );
}

describe('MovementList on the design system (FEAT-004 AC-17, AC-22)', () => {
  it('shows an empty state with a call to action to record the first movement', () => {
    const { container } = list([]);

    const empty = container.querySelector<HTMLElement>('[data-slot="empty-state"]');
    if (empty === null) throw new Error('Expected an empty state');
    expect(
      within(empty).getByRole('heading', { name: es.movements.list.emptyTitle }),
    ).toBeDefined();
    expect(within(empty).getByText(es.movements.list.empty)).toBeDefined();
    expect(
      within(empty).getByRole('link', { name: es.movements.list.newMovement }).getAttribute('href'),
    ).toBe('/es/movements/new');
    expect(screen.getAllByRole('link', { name: es.movements.list.newMovement })).toHaveLength(1);
  });

  it('separates the rows by day in the user time zone, keeping the given order', () => {
    list([
      listItem('m1', 'expense', '2026-10-02T15:30:00.000Z'),
      listItem('m2', 'expense', '2026-10-02T13:00:00.000Z'),
      // 01:00 UTC is still the previous day in Buenos Aires.
      listItem('m3', 'income', '2026-10-02T01:00:00.000Z'),
    ]);

    const days = screen.getAllByRole('heading', { level: 2 });
    expect(days.map((day) => day.textContent)).toEqual([
      dayHeading('2026-10-02T15:30:00.000Z'),
      dayHeading('2026-10-02T01:00:00.000Z'),
    ]);
    const groups = screen.getAllByRole('list');
    expect(groups.map((group) => within(group).getAllByRole('listitem').length)).toEqual([2, 1]);
  });

  it('renders each movement as a list row with its time, account and category', () => {
    list([listItem('m1', 'expense', '2026-10-02T15:30:00.000Z')]);

    const row = screen.getByRole('listitem');
    expect(row.querySelector('[data-slot="list-row"]')).not.toBeNull();
    expect(within(row).getByText('Comida')).toBeDefined();
    expect(within(row).getByText('Caja')).toBeDefined();
    expect(within(row).getByText(/12:30/)).toBeDefined();
  });

  it('shows direction with a sign and a screen-reader label, not colour alone', () => {
    list([
      listItem('m1', 'expense', '2026-10-02T15:30:00.000Z'),
      listItem('m2', 'income', '2026-10-02T14:30:00.000Z', { currency: 'USD' }),
    ]);

    const [expense, income] = screen.getAllByRole('listitem').map((row) => {
      const amount = row.querySelector('[data-slot="amount"]');
      if (amount === null) throw new Error('Expected an Amount');
      return amount;
    });
    expect(expense?.getAttribute('data-kind')).toBe('expense');
    expect(expense?.textContent).toContain(es.movements.types.expense);
    expect(expense?.textContent).toContain('−');
    expect(income?.getAttribute('data-kind')).toBe('income');
    expect(income?.textContent).toContain(es.movements.types.income);
    expect(income?.textContent).toContain('+');
  });

  it('shows the frozen rate only on a USD-account row', () => {
    list([
      listItem('m1', 'expense', '2026-10-02T15:30:00.000Z'),
      listItem('m2', 'expense', '2026-10-02T14:30:00.000Z', { currency: 'USD' }),
    ]);

    const rows = screen.getAllByRole('listitem');
    const [ars, usd] = rows;
    if (ars === undefined || usd === undefined) throw new Error('Expected two rows');
    expect(within(ars).queryByText(/ARS por USD/)).toBeNull();
    expect(within(usd).getByText(/1250,50 ARS por USD/)).toBeDefined();
  });
});

describe('MovementSaved (FEAT-004 AC-17)', () => {
  it('announces the saved movement in a calm success alert with the frozen rate and a way back', () => {
    const { container } = renderIntl(<MovementSaved rate="1250,50" />);

    // A notice above the entry form, not a page of its own: it brings no heading.
    expect(screen.queryByRole('heading')).toBeNull();
    const notice = container.querySelector('[data-slot="alert"]');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.textContent).toContain(es.movements.saved.title);
    expect(notice?.textContent).toContain(es.movements.saved.rate.replace('{rate}', '1250,50'));
    expect(screen.getByRole('link', { name: es.movements.saved.back }).getAttribute('href')).toBe(
      '/es/movements',
    );
  });
});

describe('MovementList category icons', () => {
  it('shows each movement with the icon and color of its own category', () => {
    const { container } = list([
      listItem('m1', 'expense', '2026-09-30T15:00:00.000Z', {
        categoryIcon: 'utensils',
        categoryColor: 'orange',
      }),
      listItem('m2', 'income', '2026-09-30T14:00:00.000Z', {
        categoryIcon: 'emoji:💰',
        categoryColor: 'green',
      }),
    ]);

    const marks = [...container.querySelectorAll('[data-icon]')];
    expect(marks.map((mark) => mark.getAttribute('data-icon'))).toEqual(['utensils', 'emoji:💰']);
    expect(marks.map((mark) => mark.getAttribute('data-color'))).toEqual(['orange', 'green']);
  });

  it('falls back to the neutral icon when the category is not among the loaded ones', () => {
    const { container } = list([listItem('m1', 'expense', '2026-09-30T15:00:00.000Z')]);

    expect(container.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe('unknown');
  });
});

describe('MovementForm sad path on the design system (FEAT-004 AC-17)', () => {
  it('keeps the field error of an invalid submission and focuses the first invalid field', () => {
    const { container } = form({
      errors: { fields: { amount: 'movements.errors.amountNotPositive' } },
    });

    expect(container.querySelector('[data-slot="card"]')).not.toBeNull();
    expect(screen.getByText(es.movements.errors.amountNotPositive)).toBeDefined();
    expect(document.activeElement).toBe(label(es.movements.fields.amount));
  });
});

describe('movements round 2 (FEAT-004 review items)', () => {
  it('renders a placeholder, never a crash, for a malformed amount', () => {
    const item = listItem('m1', 'expense', '2026-10-02T15:30:00.000Z');
    list([{ ...item, movement: { ...item.movement, amount: '12.5x' } }]);

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('—')).toBeDefined();
    expect(row.querySelector('[data-slot="amount"]')).toBeNull();
  });

  it('loading skeleton rows have the real row structure and the 44px minimum (no layout shift)', () => {
    const { container } = renderIntl(
      <MovementsLoadStateView state={{ kind: 'loading' }} onRetry={vi.fn()} />,
    );

    const rows = container.querySelectorAll('[data-skeleton-row]');
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.className).toContain('min-h-11');
      expect(row.className).toContain('py-3');
      expect(row.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(1);
    }
  });

  it('groups days by the zone calendar across a DST change (America/New_York, 2026-11-01)', () => {
    const zone = 'America/New_York';
    // 01:30 happens twice that night (EDT then EST): both belong to the same day.
    expect(dayKey('2026-11-01T05:30:00.000Z', zone)).toBe('2026-11-01');
    expect(dayKey('2026-11-01T06:30:00.000Z', zone)).toBe('2026-11-01');
    // 23:59 EST of Nov 1 is still Nov 1; the day turns at 05:00 UTC, not at 04:00 UTC.
    expect(dayKey('2026-11-02T04:59:00.000Z', zone)).toBe('2026-11-01');
    expect(dayKey('2026-11-02T05:00:00.000Z', zone)).toBe('2026-11-02');
    expect(dayKey('2026-11-01T03:59:00.000Z', zone)).toBe('2026-10-31');
    expect(formatDay('2026-11-01T06:30:00.000Z', 'en', zone)).toBe('Sunday, November 1, 2026');
  });
});
