// @vitest-environment happy-dom
import type { RecurringPaymentResponse, UpcomingItem } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentDetailContainer } from '../src/features/recurring/containers/payment-detail-container';
import { PaymentFormContainer } from '../src/features/recurring/containers/payment-form-container';
import { UpcomingContainer } from '../src/features/recurring/containers/upcoming-container';
import { category, page, uuid } from './support/category-fixtures';
import { CATALOGS, renderApp, stubApi, type ApiCall } from './support/render-app';

const { en, es } = CATALOGS;
const ACCOUNT_ID = uuid(21);
const CATEGORY_ID = uuid(22);
const PAYMENT_ID = '33333333-3333-4333-8333-333333333333';
const OCCURRENCE_ID = '44444444-4444-4444-8444-444444444444';

const UPCOMING = 'GET /recurring/upcoming';
const PAYMENTS = 'GET /recurring/payments';
const PAYMENT = `GET /recurring/payments/${PAYMENT_ID}`;
const ACCOUNTS = 'GET /accounts?archived=false&limit=100';
const CATEGORIES = 'GET /categories?kind=expense&archived=false&limit=100';
const PROFILE = 'GET /profile';
const CONFIRM = `POST /recurring/occurrences/${OCCURRENCE_ID}/confirm`;
const SKIP = `POST /recurring/occurrences/${OCCURRENCE_ID}/skip`;

const account = {
  id: ACCOUNT_ID,
  name: 'Galicia',
  type: 'bank_account',
  currency: 'ARS',
  openingBalance: '0',
  balance: '0',
  includeInAvailable: true,
  archived: false,
  archivedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
};

const upcomingItem: UpcomingItem = {
  kind: 'overdue',
  dueDate: '2026-10-05',
  paymentId: PAYMENT_ID,
  name: 'Rent',
  amount: '35000000',
  accountId: ACCOUNT_ID,
  categoryId: CATEGORY_ID,
  occurrenceId: OCCURRENCE_ID,
};

const payment: RecurringPaymentResponse = {
  id: PAYMENT_ID,
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
};

const reference = {
  [ACCOUNTS]: {
    status: 200,
    body: {
      items: [account],
      availableTotals: { ARS: '0', USD: '0' },
      netWorthTotals: { ARS: '0', USD: '0' },
      debtTotals: { ARS: '0', USD: '0' },
      creditCardCount: 0,
      total: 1,
      limit: 100,
      offset: 0,
    },
  },
  [CATEGORIES]: page([category({ id: CATEGORY_ID, kind: 'expense', name: 'Housing' })]),
  [PROFILE]: {
    status: 200,
    body: {
      displayName: 'Ana',
      email: 'ana@example.com',
      twoFactorEnabled: false,
      deletionReauth: 'password',
      preferences: {
        defaultRateType: 'blue',
        displayCurrency: 'ARS',
        timeZone: 'America/Argentina/Buenos_Aires',
        language: 'en',
      },
    },
  },
} as const;

const upcomingRoutes = (overrides: Record<string, Parameters<typeof stubApi>[0][string]> = {}) => ({
  ...reference,
  [UPCOMING]: { status: 200, body: { items: [upcomingItem] } },
  [PAYMENTS]: { status: 200, body: { items: [payment] } },
  ...overrides,
});

const writes = (calls: ApiCall[]) => calls.filter((call) => call.method !== 'GET');
const count = (calls: ApiCall[], path: string) =>
  calls.filter((call) => call.method === 'GET' && call.path === path).length;

async function openUpcoming(routes = upcomingRoutes(), locale: 'en' | 'es' = 'en') {
  const stub = stubApi(routes);
  const view = renderApp(<UpcomingContainer />, { locale });
  await screen.findByRole('list', { name: CATALOGS[locale].recurring.list.toConfirmLabel });
  return { ...stub, ...view };
}

const confirmButton = (locale: 'en' | 'es' = 'en') =>
  screen.getByRole('button', { name: `${CATALOGS[locale].recurring.actions.confirm} Rent` });

describe('UpcomingContainer', () => {
  it('confirms with an edited amount and reloads the list (AC-07)', async () => {
    const { calls } = await openUpcoming(
      upcomingRoutes({
        [CONFIRM]: { status: 204 },
        [UPCOMING]: [
          { status: 200, body: { items: [upcomingItem] } },
          { status: 200, body: { items: [] } },
        ],
      }),
    );
    const user = userEvent.setup();
    await user.click(confirmButton());

    const amount = screen.getByLabelText<HTMLInputElement>(en.recurring.confirm.amount);
    expect(amount.value).toBe('350,000.00');
    await user.clear(amount);
    await user.type(amount, '48250.00');
    await user.click(screen.getByRole('button', { name: en.recurring.confirm.submit }));

    await waitFor(() => {
      expect(count(calls, '/recurring/upcoming')).toBe(2);
    });
    expect(writes(calls)).toEqual([
      {
        method: 'POST',
        path: `/recurring/occurrences/${OCCURRENCE_ID}/confirm`,
        body: { amount: '4825000', date: '2026-10-05' },
      },
    ]);
    expect(screen.queryByRole('list', { name: en.recurring.list.upcomingLabel })).toBeNull();
  });

  it('shows the message and sends nothing for an invalid amount (AC-02)', async () => {
    const { calls } = await openUpcoming();
    const user = userEvent.setup();
    await user.click(confirmButton());
    await user.clear(screen.getByLabelText(en.recurring.confirm.amount));
    await user.click(screen.getByRole('button', { name: en.recurring.confirm.submit }));

    expect(await screen.findByText(en.movements.errors.amountInvalid)).toBeDefined();
    expect(writes(calls)).toEqual([]);
  });

  it('maps a 409 on confirm to its message and refreshes the list (AC-08)', async () => {
    const { calls } = await openUpcoming(
      upcomingRoutes({
        [CONFIRM]: { status: 409, body: { code: 'RECURRING_OCCURRENCE_NOT_PENDING' } },
        [UPCOMING]: [
          { status: 200, body: { items: [upcomingItem] } },
          { status: 200, body: { items: [{ ...upcomingItem, kind: 'scheduled' }] } },
        ],
      }),
    );
    const user = userEvent.setup();
    await user.click(confirmButton());
    await user.click(screen.getByRole('button', { name: en.recurring.confirm.submit }));

    expect(await screen.findByText(en.errors.recurringOccurrenceNotPending)).toBeDefined();
    await waitFor(() => {
      expect(count(calls, '/recurring/upcoming')).toBe(2);
    });
    // Once refreshed the payment is only scheduled: it moves to the upcoming list, with no actions.
    const scheduledRent = within(
      screen.getByRole('list', { name: en.recurring.list.upcomingLabel }),
    ).getByRole('listitem', { name: 'Rent' });
    expect(within(scheduledRent).queryByRole('button')).toBeNull();
  });

  it('keeps the form and its values when the request fails on the network', async () => {
    await openUpcoming(upcomingRoutes({ [CONFIRM]: 'network-error' }));
    const user = userEvent.setup();
    await user.click(confirmButton());
    const amount = screen.getByLabelText<HTMLInputElement>(en.recurring.confirm.amount);
    await user.clear(amount);
    await user.type(amount, '1000.00');
    await user.click(screen.getByRole('button', { name: en.recurring.confirm.submit }));

    expect(await screen.findByText(en.errors.network)).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>(en.recurring.confirm.amount).value).toBe(
      '1,000.00',
    );
  });

  it('skips an occurrence and reloads the list (AC-09)', async () => {
    const { calls } = await openUpcoming(
      upcomingRoutes({
        [SKIP]: { status: 204 },
        [UPCOMING]: [
          { status: 200, body: { items: [upcomingItem] } },
          { status: 200, body: { items: [] } },
        ],
      }),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: `${en.recurring.actions.skip} Rent` }));

    await waitFor(() => {
      expect(screen.queryByRole('list', { name: en.recurring.list.upcomingLabel })).toBeNull();
    });
    expect(writes(calls)).toEqual([
      { method: 'POST', path: `/recurring/occurrences/${OCCURRENCE_ID}/skip`, body: {} },
    ]);
  });

  it('shows the empty state with a link to create the first payment', async () => {
    stubApi(
      upcomingRoutes({
        [UPCOMING]: { status: 200, body: { items: [] } },
        [PAYMENTS]: { status: 200, body: { items: [] } },
      }),
    );
    renderApp(<UpcomingContainer />, { locale: 'en' });
    expect(await screen.findByText(en.recurring.list.emptyTitle)).toBeDefined();
    expect(
      screen.getByRole('link', { name: en.recurring.list.newPayment }).getAttribute('href'),
    ).toBe('/en/recurring/new');
  });

  it('shows a retryable error when the list cannot load', async () => {
    stubApi(upcomingRoutes({ [UPCOMING]: { status: 500 } }));
    renderApp(<UpcomingContainer />, { locale: 'en' });
    expect(await screen.findByText(en.errors.unexpected)).toBeDefined();
  });

  it('renders labels and statuses in Spanish (AC-19)', async () => {
    await openUpcoming(upcomingRoutes(), 'es');
    expect(screen.getByText(es.recurring.status.overdue)).toBeDefined();
    expect(confirmButton('es')).toBeDefined();
    expect(screen.getByRole('link', { name: es.recurring.list.newPayment })).toBeDefined();
  });
});

describe('PaymentFormContainer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T15:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function openForm() {
    const stub = stubApi({
      ...reference,
      'POST /recurring/payments': { status: 201, body: payment },
    });
    const view = renderApp(<PaymentFormContainer />, { locale: 'en' });
    await screen.findByLabelText(en.recurring.fields.name);
    return { ...stub, ...view };
  }

  it('sends nothing and shows the messages for invalid values (AC-02)', async () => {
    const { calls } = await openForm();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: en.recurring.actions.create }));

    expect(await screen.findByText(en.recurring.errors.nameRequired)).toBeDefined();
    expect(screen.getByText(en.recurring.errors.dayOfMonthRequired)).toBeDefined();
    expect(writes(calls)).toEqual([]);
  });

  it('creates the Rent payment and goes back to the list (AC-01)', async () => {
    const { calls, router } = await openForm();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(en.recurring.fields.name), 'Rent');
    await user.type(screen.getByLabelText(en.recurring.fields.amount), '350000.00');
    await user.selectOptions(screen.getByLabelText(en.recurring.fields.account), ACCOUNT_ID);
    await user.selectOptions(screen.getByLabelText(en.recurring.fields.category), CATEGORY_ID);
    await user.type(screen.getByLabelText(en.recurring.fields.dayOfMonth), '5');
    await user.selectOptions(screen.getByLabelText(en.recurring.mode.label), 'confirmation');
    await user.click(screen.getByRole('button', { name: en.recurring.actions.create }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/en/recurring');
    });
    expect(writes(calls)).toEqual([
      {
        method: 'POST',
        path: '/recurring/payments',
        body: {
          name: 'Rent',
          amount: '35000000',
          accountId: ACCOUNT_ID,
          categoryId: CATEGORY_ID,
          frequency: 'monthly',
          dayOfMonth: 5,
          startDate: '2026-10-09',
          mode: 'confirmation',
        },
      },
    ]);
  });
});

describe('PaymentDetailContainer', () => {
  const PAUSE = `POST /recurring/payments/${PAYMENT_ID}/pause`;
  const RESUME = `POST /recurring/payments/${PAYMENT_ID}/resume`;

  const detailRoutes = (overrides: Record<string, Parameters<typeof stubApi>[0][string]> = {}) => ({
    ...reference,
    [PAYMENT]: { status: 200, body: payment },
    ...overrides,
  });

  async function openDetail(routes = detailRoutes()) {
    const stub = stubApi(routes);
    const view = renderApp(<PaymentDetailContainer paymentId={PAYMENT_ID} />, { locale: 'en' });
    await screen.findByRole('heading', { name: 'Rent' });
    return { ...stub, ...view };
  }

  it('pauses and resumes, updating the status (AC-13, AC-14)', async () => {
    const paused = { ...payment, status: 'paused', nextDueDate: null };
    const { calls } = await openDetail(
      detailRoutes({
        [PAUSE]: { status: 200, body: paused },
        [RESUME]: { status: 200, body: payment },
      }),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: en.recurring.actions.pause }));
    expect(await screen.findByText(en.recurring.status.paused)).toBeDefined();

    await user.click(screen.getByRole('button', { name: en.recurring.actions.resume }));
    expect(await screen.findByText(en.recurring.status.active)).toBeDefined();
    expect(writes(calls).map((call) => call.path)).toEqual([
      `/recurring/payments/${PAYMENT_ID}/pause`,
      `/recurring/payments/${PAYMENT_ID}/resume`,
    ]);
  });

  it('asks for explicit confirmation before deleting, then returns to the list (AC-15)', async () => {
    const { calls, router } = await openDetail(
      detailRoutes({ [`DELETE /recurring/payments/${PAYMENT_ID}`]: { status: 204 } }),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: en.recurring.actions.delete }));
    expect(screen.getByText(en.recurring.deleteConfirm.title)).toBeDefined();
    expect(writes(calls)).toEqual([]);

    await user.click(screen.getByRole('button', { name: en.recurring.deleteConfirm.cancel }));
    expect(writes(calls)).toEqual([]);

    await user.click(screen.getByRole('button', { name: en.recurring.actions.delete }));
    await user.click(screen.getByRole('button', { name: en.recurring.deleteConfirm.confirm }));
    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/en/recurring');
    });
    expect(writes(calls)).toEqual([
      { method: 'DELETE', path: `/recurring/payments/${PAYMENT_ID}`, body: undefined },
    ]);
  });

  it('edits the amount and shows the saved payment (AC-12)', async () => {
    const saved = { ...payment, amount: '40000000' };
    const { calls } = await openDetail(
      detailRoutes({ [`PATCH /recurring/payments/${PAYMENT_ID}`]: { status: 200, body: saved } }),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: en.recurring.actions.edit }));
    const amount = screen.getByLabelText<HTMLInputElement>(en.recurring.fields.amount);
    expect(amount.value).toBe('350,000.00');
    await user.clear(amount);
    await user.type(amount, '400000.00');
    await user.click(screen.getByRole('button', { name: en.recurring.actions.save }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: en.recurring.actions.save })).toBeNull();
    });
    expect(writes(calls)).toHaveLength(1);
    expect(writes(calls)[0]).toMatchObject({
      method: 'PATCH',
      body: { name: 'Rent', amount: '40000000', frequency: 'monthly', dayOfMonth: 5 },
    });
  });

  it("shows the not found message for a payment that is not the user's", async () => {
    stubApi(detailRoutes({ [PAYMENT]: { status: 404, body: { code: 'NOT_FOUND' } } }));
    renderApp(<PaymentDetailContainer paymentId={PAYMENT_ID} />, { locale: 'en' });
    expect(await screen.findByText(en.recurring.notFound)).toBeDefined();
  });
});
