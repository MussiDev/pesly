// @vitest-environment happy-dom
import type { RecurringPaymentResponse, UpcomingItem } from '@pesly/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmOccurrenceForm } from '../src/features/recurring/components/confirm-occurrence-form';
import type { RecurringLookups } from '../src/features/recurring/components/recurring-lookups';
import { RecurringPaymentForm } from '../src/features/recurring/components/recurring-payment-form';
import { RecurringPaymentList } from '../src/features/recurring/components/recurring-payment-list';
import type { ConfirmFormValues } from '../src/features/recurring/recurring-request';
import { UpcomingList } from '../src/features/recurring/components/upcoming-list';
import { CATALOGS, renderApp } from './support/render-app';

const { en, es } = CATALOGS;
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const NBSP = String.fromCharCode(0xa0);

const lookups: RecurringLookups = {
  accounts: { [ACCOUNT_ID]: { name: 'Galicia', currency: 'ARS' } },
  categories: { [CATEGORY_ID]: 'Housing' },
};

function item(overrides: Partial<UpcomingItem>): UpcomingItem {
  return {
    kind: 'pending',
    dueDate: '2026-10-05',
    paymentId: '33333333-3333-4333-8333-333333333333',
    name: 'Rent',
    amount: '35000000',
    accountId: ACCOUNT_ID,
    categoryId: CATEGORY_ID,
    occurrenceId: '44444444-4444-4444-8444-444444444444',
    ...overrides,
  };
}

const OVERDUE = item({ kind: 'overdue', name: 'Gym', dueDate: '2026-09-20', occurrenceId: 'o-1' });
const PENDING = item({ kind: 'pending', name: 'Rent', occurrenceId: 'o-2' });
const SCHEDULED = item({
  kind: 'scheduled',
  name: 'Netflix',
  dueDate: '2026-10-20',
  occurrenceId: null,
});

const noop = () => undefined;
const listProps = {
  lookups,
  confirmingId: undefined,
  pending: false,
  confirmErrors: {},
  notice: undefined,
  onConfirmOpen: noop,
  onConfirmCancel: noop,
  onConfirmSubmit: noop,
  onSkip: noop,
};

describe('RecurringPaymentForm', () => {
  const formProps = {
    mode: 'create' as const,
    accounts: [{ id: ACCOUNT_ID, label: 'Galicia (ARS)' }],
    categories: [{ id: CATEGORY_ID, label: 'Housing' }],
    defaultStartDate: '2026-10-09',
    pending: false,
    errors: {},
    onSubmit: noop,
  };

  it('offers exactly weekly, monthly and yearly, and the day fields follow the choice (AC-03)', async () => {
    renderApp(<RecurringPaymentForm {...formProps} />, { locale: 'en' });
    const user = userEvent.setup();
    const frequency = screen.getByLabelText<HTMLSelectElement>(en.recurring.frequency.label);
    expect(Array.from(frequency.options).map((option) => option.value)).toEqual([
      'weekly',
      'monthly',
      'yearly',
    ]);

    // Monthly (default): only the day of the month.
    expect(screen.getByLabelText(en.recurring.fields.dayOfMonth)).toBeDefined();
    expect(screen.queryByLabelText(en.recurring.weekday.label)).toBeNull();
    expect(screen.queryByLabelText(en.recurring.month.label)).toBeNull();

    await user.selectOptions(frequency, 'weekly');
    expect(screen.getByLabelText(en.recurring.weekday.label)).toBeDefined();
    expect(screen.queryByLabelText(en.recurring.fields.dayOfMonth)).toBeNull();

    await user.selectOptions(frequency, 'yearly');
    expect(screen.getByLabelText(en.recurring.month.label)).toBeDefined();
    expect(screen.getByLabelText(en.recurring.fields.dayOfMonth)).toBeDefined();
    expect(screen.queryByLabelText(en.recurring.weekday.label)).toBeNull();
  });

  it('hands the typed values to the container on submit (AC-01)', async () => {
    const onSubmit = vi.fn();
    renderApp(<RecurringPaymentForm {...formProps} onSubmit={onSubmit} />, { locale: 'en' });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(en.recurring.fields.name), 'Rent');
    await user.type(screen.getByLabelText(en.recurring.fields.amount), '350000.00');
    await user.selectOptions(screen.getByLabelText(en.recurring.fields.account), ACCOUNT_ID);
    await user.selectOptions(screen.getByLabelText(en.recurring.fields.category), CATEGORY_ID);
    await user.type(screen.getByLabelText(en.recurring.fields.dayOfMonth), '5');
    await user.selectOptions(screen.getByLabelText(en.recurring.mode.label), 'confirmation');
    await user.click(screen.getByRole('button', { name: en.recurring.actions.create }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      name: 'Rent',
      accountId: ACCOUNT_ID,
      categoryId: CATEGORY_ID,
      frequency: 'monthly',
      dayOfMonth: '5',
      startDate: '2026-10-09',
      endDate: '',
      mode: 'confirmation',
    });
  });

  it('shows per-field messages (AC-02)', () => {
    renderApp(
      <RecurringPaymentForm
        {...formProps}
        errors={{ fields: { name: 'recurring.errors.nameRequired' } }}
      />,
      { locale: 'en' },
    );
    expect(screen.getByText(en.recurring.errors.nameRequired)).toBeDefined();
  });

  it('labels the edit form with its own title and prefilled values', () => {
    renderApp(
      <RecurringPaymentForm
        {...formProps}
        mode="edit"
        initial={{
          name: 'Gym',
          amount: '1,500.00',
          accountId: ACCOUNT_ID,
          categoryId: CATEGORY_ID,
          frequency: 'weekly',
          weekday: '2',
          dayOfMonth: '',
          month: '',
          startDate: '2026-10-01',
          endDate: '',
          mode: 'automatic',
        }}
      />,
      { locale: 'en' },
    );
    expect(screen.getByRole('heading', { name: en.recurring.form.editTitle })).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>(en.recurring.fields.name).value).toBe('Gym');
    expect(screen.getByLabelText<HTMLSelectElement>(en.recurring.weekday.label).value).toBe('2');
    expect(screen.getByRole('button', { name: en.recurring.actions.save })).toBeDefined();
  });
});

describe('UpcomingList', () => {
  it('lists overdue, then pending, then scheduled, with the right badge and actions (AC-10, AC-11)', () => {
    // Given out of order on purpose: the list owns the order.
    renderApp(<UpcomingList {...listProps} items={[SCHEDULED, PENDING, OVERDUE]} />, {
      locale: 'en',
    });
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['Gym', 'Rent', 'Netflix']);

    const [overdue, pending, scheduled] = rows;
    if (!overdue || !pending || !scheduled) throw new Error('Expected three rows');
    const { confirm, skip } = en.recurring.actions;
    expect(within(overdue).getByText(en.recurring.status.overdue)).toBeDefined();
    expect(within(overdue).getByRole('button', { name: `${confirm} Gym` })).toBeDefined();
    expect(within(overdue).getByRole('button', { name: `${skip} Gym` })).toBeDefined();
    expect(within(pending).getByText(en.recurring.status.pending)).toBeDefined();
    expect(within(pending).getByRole('button', { name: `${confirm} Rent` })).toBeDefined();
    expect(within(scheduled).getByText(en.recurring.status.scheduled)).toBeDefined();
    expect(within(scheduled).queryByRole('button')).toBeNull();
  });

  it('shows the due date, the account amount and a link to each payment', () => {
    renderApp(<UpcomingList {...listProps} items={[PENDING]} />, { locale: 'en' });
    const row = screen.getByRole('listitem', { name: 'Rent' });
    expect(
      within(row).getByText(en.recurring.list.dueOn.replace('{date}', 'Oct 5, 2026')),
    ).toBeDefined();
    expect(row.textContent).toContain(`350,000.00${NBSP}ARS`);
    expect(within(row).getByRole('link', { name: 'Rent' }).getAttribute('href')).toBe(
      `/en/recurring/${PENDING.paymentId}`,
    );
  });

  it('reports confirm and skip for the row', async () => {
    const onSkip = vi.fn();
    const onConfirmOpen = vi.fn();
    renderApp(
      <UpcomingList
        {...listProps}
        items={[PENDING]}
        onSkip={onSkip}
        onConfirmOpen={onConfirmOpen}
      />,
      { locale: 'en' },
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: `${en.recurring.actions.confirm} Rent` }));
    expect(onConfirmOpen).toHaveBeenCalledWith(PENDING);
    await user.click(screen.getByRole('button', { name: `${en.recurring.actions.skip} Rent` }));
    expect(onSkip).toHaveBeenCalledWith(PENDING);
  });

  it('renders the notice when one is given', () => {
    renderApp(
      <UpcomingList
        {...listProps}
        items={[PENDING]}
        notice="errors.recurringOccurrenceNotPending"
      />,
      { locale: 'en' },
    );
    expect(screen.getByText(en.errors.recurringOccurrenceNotPending)).toBeDefined();
  });

  it('renders every label and status in Spanish (AC-19)', () => {
    renderApp(<UpcomingList {...listProps} items={[OVERDUE, PENDING, SCHEDULED]} />, {
      locale: 'es',
    });
    expect(screen.getByText(es.recurring.status.overdue)).toBeDefined();
    expect(screen.getByText(es.recurring.status.pending)).toBeDefined();
    expect(screen.getByText(es.recurring.status.scheduled)).toBeDefined();
    expect(
      screen.getByRole('button', { name: `${es.recurring.actions.confirm} Gym` }),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: `${es.recurring.actions.skip} Gym` })).toBeDefined();
    expect(screen.getByRole('list', { name: es.recurring.list.upcomingLabel })).toBeDefined();
  });
});

describe('ConfirmOccurrenceForm', () => {
  const props = {
    name: 'Rent',
    defaultAmount: '350,000.00',
    defaultDate: '2026-10-05',
    pending: false,
    errors: {},
    onSubmit: noop,
    onCancel: noop,
  };

  it('is prefilled with the payment amount and date, and submits the edited amount (AC-07)', async () => {
    const onSubmit = vi.fn<(values: ConfirmFormValues) => void>();
    renderApp(<ConfirmOccurrenceForm {...props} onSubmit={onSubmit} />, { locale: 'en' });
    const amount = screen.getByLabelText<HTMLInputElement>(en.recurring.confirm.amount);
    expect(amount.value).toBe('350,000.00');
    expect(screen.getByLabelText<HTMLInputElement>(en.recurring.confirm.date).value).toBe(
      '2026-10-05',
    );

    const user = userEvent.setup();
    await user.clear(amount);
    await user.type(amount, '48250.00');
    await user.click(screen.getByRole('button', { name: en.recurring.confirm.submit }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ date: '2026-10-05' });
    expect(onSubmit.mock.calls[0]?.[0].amount.replace(',', '')).toBe('48250.00');
  });

  it('shows its field messages and a form-level alert', () => {
    renderApp(
      <ConfirmOccurrenceForm
        {...props}
        errors={{ form: 'errors.network', fields: { amount: 'movements.errors.amountInvalid' } }}
      />,
      { locale: 'en' },
    );
    expect(screen.getByText(en.movements.errors.amountInvalid)).toBeDefined();
    expect(screen.getByText(en.errors.network)).toBeDefined();
  });
});

describe('RecurringPaymentList', () => {
  const payment = (overrides: Partial<RecurringPaymentResponse>): RecurringPaymentResponse => ({
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Rent',
    amount: '35000000',
    accountId: ACCOUNT_ID,
    categoryId: CATEGORY_ID,
    frequency: 'monthly',
    weekday: null,
    dayOfMonth: 5,
    month: null,
    startDate: '2026-10-05',
    endDate: null,
    mode: 'confirmation',
    status: 'active',
    nextDueDate: '2026-11-05',
    ...overrides,
  });

  it('shows each payment with its status and next date', () => {
    renderApp(
      <RecurringPaymentList
        lookups={lookups}
        payments={[
          payment({}),
          payment({
            id: '66666666-6666-4666-8666-666666666666',
            name: 'Gym',
            status: 'paused',
            nextDueDate: null,
          }),
        ]}
      />,
      { locale: 'en' },
    );
    const rent = screen.getByRole('listitem', { name: 'Rent' });
    expect(within(rent).getByText(en.recurring.status.active)).toBeDefined();
    expect(
      within(rent).getByText(en.recurring.list.nextDue.replace('{date}', 'Nov 5, 2026')),
    ).toBeDefined();
    const gym = screen.getByRole('listitem', { name: 'Gym' });
    expect(within(gym).getByText(en.recurring.status.paused)).toBeDefined();
    expect(within(gym).getByText(en.recurring.list.noNextDue)).toBeDefined();
  });
});
