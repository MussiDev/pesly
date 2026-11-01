// @vitest-environment happy-dom
import {
  planInstallments,
  type CreditCardResponse,
  type InstallmentPurchaseResponse,
  type StatementResponse,
} from '@pesly/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreditCardDetailContainer } from '../src/features/credit-cards/containers/credit-card-detail-container';
import { InstallmentPurchaseContainer } from '../src/features/credit-cards/containers/installment-purchase-container';
import { formatCalendarDate, formatPeriod } from '../src/features/credit-cards/format-dates';
import { formatMoney } from '../src/lib/format-amount';
import { category, page, uuid } from './support/category-fixtures';
import { CATALOGS, renderApp, stubApi, type ApiCall } from './support/render-app';
import { pickSegment, segmentOption, segmentValue } from './support/segmented';

const { es, en } = CATALOGS;
const NBSP = String.fromCharCode(0xa0);

/** 12:30 in Buenos Aires (UTC-3). */
const NOW = '2026-10-02T15:30:00.000Z';
const ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const CARD_PATH = `/credit-cards/${ID}`;
const CARD = `GET ${CARD_PATH}`;
const PROFILE = 'GET /profile';
const CATEGORIES = 'GET /categories?kind=expense&archived=false&limit=100';
const STATEMENTS = `GET ${CARD_PATH}/statements`;
const POST = `POST ${CARD_PATH}/installment-purchases`;
const POST_EXPENSE = `POST ${CARD_PATH}/expenses`;
const SAVED_EXPENSE = {
  movementId: uuid(99),
  accountId: '11111111-1111-4111-8111-111111111111',
  currency: 'ARS',
  amount: '100000',
  occurredAt: NOW,
  statementId: uuid(98),
};
const COMIDA_ID = uuid(11);

const card: CreditCardResponse = {
  id: ID,
  name: 'Visa',
  closingDay: 24,
  dueDay: 5,
  arsAccountId: '11111111-1111-4111-8111-111111111111',
  usdAccountId: '22222222-2222-4222-8222-222222222222',
  debitArsAccountId: null,
  debitUsdAccountId: null,
  reminderDays: 3,
  createdAt: '2026-10-01T12:00:00.000Z',
};

const PURCHASE_ID = uuid(77);

function purchase(
  overrides: Partial<InstallmentPurchaseResponse> = {},
): InstallmentPurchaseResponse {
  return {
    id: PURCHASE_ID,
    cardId: ID,
    categoryId: COMIDA_ID,
    amount: '12000000',
    currency: 'ARS',
    installmentCount: 12,
    purchasedOn: '2026-10-02',
    note: 'Heladera',
    createdAt: NOW,
    installments: Array.from({ length: 12 }, (_, index) => ({
      number: index + 1,
      amount: '1000000',
      period: '2026-10',
      closingDate: '2026-10-24',
      dueDate: '2026-11-05',
      status: 'open' as const,
    })),
    ...overrides,
  };
}

const CLOSED_STATEMENT: StatementResponse = {
  id: uuid(51),
  cardId: ID,
  period: '2026-09',
  closingDate: '2026-09-24',
  dueDate: '2026-10-05',
  status: 'closed',
  totals: { ARS: '0', USD: '0' },
  installments: [],
  payments: null,
};
const OPEN_STATEMENT: StatementResponse = {
  ...CLOSED_STATEMENT,
  id: uuid(52),
  period: '2026-10',
  closingDate: '2026-10-24',
  dueDate: '2026-11-05',
  status: 'open',
};

function formRoutes(overrides: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  return {
    [CARD]: { status: 200, body: card },
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
          language: 'es',
        },
      },
    },
    [CATEGORIES]: page([
      category({ id: COMIDA_ID, kind: 'expense', name: 'Comida' }),
      category({ id: uuid(13), kind: 'expense', name: 'Vieja', archived: true }),
    ]),
    [STATEMENTS]: { status: 200, body: { items: [CLOSED_STATEMENT, OPEN_STATEMENT] } },
    [POST]: { status: 201, body: purchase() },
    [POST_EXPENSE]: { status: 201, body: SAVED_EXPENSE },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

const posts = (calls: ApiCall[]) => calls.filter((call) => call.method === 'POST');
const t = es.creditCards.installments;

async function open(answers = formRoutes(), locale: 'es' | 'en' = 'es') {
  const stub = stubApi(answers);
  const view = renderApp(<InstallmentPurchaseContainer cardId={ID} />, { locale });
  await screen.findByLabelText(CATALOGS[locale].creditCards.installments.fields.amount);
  return { ...stub, ...view };
}

const field = (name: string) => screen.getByLabelText<HTMLInputElement>(name);
const submit = () => screen.getByRole('button', { name: t.submit });

async function fill(amount: string, installments: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('radio', { name: 'Comida' }));
  if (amount !== '') await user.type(field(t.fields.amount), amount);
  if (installments !== '') await user.type(field(t.fields.installments), installments);
  return user;
}

describe('InstallmentPurchaseContainer', () => {
  it('posts 120.000,00 in 12 installments and returns to the card page (AC-01)', async () => {
    const { calls, router } = await open();
    const user = await fill('120000', '12');
    await user.click(submit());

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/es/cards/${ID}`);
    });
    expect(posts(calls)).toEqual([
      {
        method: 'POST',
        path: `${CARD_PATH}/installment-purchases`,
        body: {
          currency: 'ARS',
          categoryId: COMIDA_ID,
          amount: '12000000',
          installments: 12,
          purchasedOn: '2026-10-02',
        },
      },
    ]);
  });

  it('calls the card expense endpoint for one payment, as a plain expense (single payment)', async () => {
    const { calls, router } = await open();
    const user = await fill('1000', '1');
    await user.click(submit());

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/es/cards/${ID}`);
    });
    expect(posts(calls)).toEqual([
      {
        method: 'POST',
        path: `${CARD_PATH}/expenses`,
        body: {
          currency: 'ARS',
          categoryId: COMIDA_ID,
          amount: '100000',
          occurredAt: NOW,
          rate: { source: 'automatic' },
        },
      },
    ]);
  });

  it('posts a USD installment purchase when USD is chosen (USD installments)', async () => {
    const { calls } = await open();
    const user = await fill('1200', '12');
    await pickSegment(t.fields.currency, 'USD');
    await user.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(posts(calls)[0]).toMatchObject({
      path: `${CARD_PATH}/installment-purchases`,
      body: { currency: 'USD', amount: '120000', installments: 12 },
    });
  });

  it('shows the field message for 0 and for 61 installments and sends nothing (AC-02)', async () => {
    const { calls } = await open();
    const user = await fill('1000', '0');
    await user.click(submit());

    expect(await screen.findByText(t.errors.installmentsInvalid)).toBeDefined();
    expect(document.activeElement).toBe(field(t.fields.installments));
    await user.clear(field(t.fields.installments));
    await user.type(field(t.fields.installments), '61');
    await user.click(submit());
    expect(await screen.findByText(t.errors.installmentsInvalid)).toBeDefined();
    expect(posts(calls)).toEqual([]);
  });

  it('offers ARS (default) and USD, and only open expense categories (AC-03)', async () => {
    await open();

    expect(segmentValue(t.fields.currency)).toBe('ARS');
    expect(segmentOption(t.fields.currency, 'USD')).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Comida' })).toBeDefined();
    expect(screen.queryByRole('radio', { name: 'Vieja' })).toBeNull();
  });

  it('shows the not-found state when the card answers 404 (sad path)', async () => {
    stubApi(formRoutes({ [CARD]: { status: 404, body: { code: 'NOT_FOUND' } } }));
    renderApp(<InstallmentPurchaseContainer cardId={ID} />);

    expect(await screen.findByText(t.notFound)).toBeDefined();
  });

  it('shows the not-found state when the save answers 404 (sad path)', async () => {
    await open(formRoutes({ [POST]: { status: 404, body: { code: 'NOT_FOUND' } } }));
    const user = await fill('1000', '3');
    await user.click(submit());

    expect(await screen.findByText(t.notFound)).toBeDefined();
  });

  it('shows the write limit with the Retry-After seconds and keeps the values (sad path)', async () => {
    await open(
      formRoutes({
        [POST]: { status: 429, body: { code: 'RATE_LIMITED' }, headers: { 'Retry-After': '42' } },
      }),
    );
    const user = await fill('1000', '3');
    await user.click(submit());

    expect((await screen.findByRole('alert')).textContent).toBe(
      es.movements.errors.rateLimited.replace('{seconds}', '42'),
    );
    expect(field(t.fields.amount).value).toBe('1.000');
    expect(field(t.fields.installments).value).toBe('3');
  });

  it('shows the connection-needed message and keeps the values on a network failure (sad path)', async () => {
    await open(formRoutes({ [POST]: 'network-error' }));
    const user = await fill('1000', '3');
    await user.click(submit());

    expect((await screen.findByRole('alert')).textContent).toBe(t.connectionNeeded);
    expect(field(t.fields.amount).value).toBe('1.000');
  });

  it('shows the API message for an archived category (sad path)', async () => {
    await open(formRoutes({ [POST]: { status: 409, body: { code: 'CATEGORY_ARCHIVED' } } }));
    const user = await fill('1000', '3');
    await user.click(submit());

    expect((await screen.findByRole('alert')).textContent).toBe(es.errors.categoryArchived);
  });

  it('renders in English too', async () => {
    await open(formRoutes(), 'en');

    expect(screen.getByRole('button', { name: en.creditCards.installments.submit })).toBeDefined();
  });
});

describe('the schedule preview on the purchase form', () => {
  const preview = t.preview;
  const rows = () => within(screen.getByRole('table')).getAllByRole('row').length - 1;
  const typeInto = async (user: ReturnType<typeof userEvent.setup>, name: string, text: string) => {
    await user.clear(field(name));
    await user.type(field(name), text);
  };

  it('shows the schedule for a valid amount, count and date and hides it when the amount is cleared (AC-01)', async () => {
    await open();
    expect(screen.queryByRole('table')).toBeNull();
    const user = await fill('120000', '12');

    expect(rows()).toBe(12);
    await user.clear(field(t.fields.amount));
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('updates the rows when the count or the date changes without any request (AC-08)', async () => {
    const { calls } = await open();
    const user = await fill('120000', '12');
    const before = calls.length;
    expect(rows()).toBe(12);

    await typeInto(user, t.fields.installments, '3');
    expect(rows()).toBe(3);
    fireEvent.change(field(t.fields.purchasedOn), { target: { value: '2026-09-10' } });
    expect(screen.getByText(preview.closedWarning)).toBeDefined();

    expect(calls).toHaveLength(before);
    expect(calls.filter((call) => call.path === `${CARD_PATH}/statements`)).toHaveLength(1);
  });

  it('warns when the purchase date falls in a statement that already closed (AC-06)', async () => {
    await open();
    await fill('120000', '3');
    expect(screen.queryByText(preview.closedWarning)).toBeNull();

    fireEvent.change(field(t.fields.purchasedOn), { target: { value: '2026-09-10' } });

    expect(screen.getByText(preview.closedWarning)).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain(preview.closedWarning);
    expect(screen.getByText(preview.closedBadge)).toBeDefined();
  });

  it('shows the closing date stored on the statement, not the default cycle date (AC-09)', async () => {
    await open(
      formRoutes({
        [STATEMENTS]: {
          status: 200,
          body: {
            items: [CLOSED_STATEMENT, { ...OPEN_STATEMENT, closingDate: '2026-10-20' }],
          },
        },
      }),
    );
    await fill('120000', '3');

    const first = within(screen.getAllByRole('row')[1] as HTMLElement);
    expect(first.getByText(formatCalendarDate('2026-10-20', 'es'))).toBeDefined();
    expect(first.queryByText(formatCalendarDate('2026-10-24', 'es'))).toBeNull();
  });

  it('shows the load error with no form and no schedule when the statements fail (AC-12)', async () => {
    stubApi(formRoutes({ [STATEMENTS]: { status: 500 } }));
    renderApp(<InstallmentPurchaseContainer cardId={ID} />);

    expect(await screen.findByText(es.ui.error.title)).toBeDefined();
    expect(screen.queryByLabelText(t.fields.amount)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the amount error on submit and no schedule when the amount is below the count (AC-13)', async () => {
    const { calls } = await open();
    const user = await fill('0,05', '12');

    expect(screen.queryByRole('table')).toBeNull();
    await user.click(submit());
    expect(await screen.findByText(t.errors.amountTooSmall)).toBeDefined();
    expect(posts(calls)).toEqual([]);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('saves the same body and stores what the preview showed (AC-11)', async () => {
    const { calls, router } = await open();
    const user = await fill('120000', '12');
    const shown = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    const planned = planInstallments(12_000_000n, 12, '2026-10');
    expect(shown).toHaveLength(planned.length);
    planned.forEach((expected, index) => {
      const cells = within(shown[index] as HTMLElement).getAllByRole('cell');
      expect(cells[0]?.textContent).toBe(String(expected.number));
      expect(cells[1]?.textContent).toBe(formatMoney(expected.amount, 'ARS', 'es'));
      expect(cells[2]?.textContent).toContain(formatPeriod(expected.period, 'es'));
    });

    await user.click(submit());

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/es/cards/${ID}`);
    });
    expect(posts(calls)[0]?.body).toEqual({
      currency: 'ARS',
      categoryId: COMIDA_ID,
      amount: '12000000',
      installments: 12,
      purchasedOn: '2026-10-02',
    });
  });
});

const STATEMENT: StatementResponse = {
  id: uuid(50),
  cardId: ID,
  period: '2026-10',
  closingDate: '2026-10-24',
  dueDate: '2026-11-05',
  status: 'open',
  totals: { ARS: '6000000', USD: '2000' },
  installments: [
    {
      purchaseId: PURCHASE_ID,
      number: 1,
      count: 12,
      amount: '1000000',
      currency: 'ARS',
      categoryId: COMIDA_ID,
    },
  ],
  payments: null,
};

const PENDING_11 = { ARS: '11000000', USD: '0' };

const NO_ACCOUNTS = {
  status: 200,
  body: {
    items: [],
    availableTotals: { ARS: '0', USD: '0' },
    netWorthTotals: { ARS: '0', USD: '0' },
    debtTotals: { ARS: '0', USD: '0' },
    creditCardCount: 0,
    total: 0,
    limit: 100,
    offset: 0,
  },
};

function detailRoutes(
  purchases: InstallmentPurchaseResponse[],
  pendingDebt = PENDING_11,
  overrides: Record<string, Parameters<typeof stubApi>[0][string]> = {},
) {
  return {
    [CARD]: { status: 200, body: card },
    'GET /accounts?archived=false&limit=100': NO_ACCOUNTS,
    [`GET ${CARD_PATH}/statements`]: { status: 200, body: { items: [STATEMENT] } },
    [`GET ${CARD_PATH}/installment-purchases`]: {
      status: 200,
      body: { items: purchases, pendingDebt },
    },
    ...overrides,
  };
}

const money = (text: string) => text.replaceAll(NBSP, ' ');

describe('the installments on the card page', () => {
  it('shows a pending debt of 110,000.00 ARS in English (AC-08)', async () => {
    stubApi(detailRoutes([purchase()]));
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });

    const label = en.creditCards.installments.pendingDebtLabel.replace(
      '{amount}',
      `110,000.00 ARS`,
    );
    const debt = await screen.findByLabelText((name) => money(name) === label);
    expect(money(debt.textContent)).toContain('110,000.00 ARS');
  });

  it('shows a pending debt of 110.000,00 ARS in Spanish (AC-08)', async () => {
    stubApi(detailRoutes([purchase()]));
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'es' });

    const debt = await screen.findByLabelText((name) => money(name).includes('110.000,00 ARS'));
    expect(money(debt.textContent)).toContain('110.000,00 ARS');
  });

  it('lists the installment inside its statement with the totals of both currencies (AC-07)', async () => {
    stubApi(detailRoutes([purchase()]));
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });

    const october = await screen.findByRole('listitem', { name: 'October 2026' });
    expect(money(within(october).getByLabelText(/Total in ARS/).textContent)).toBe('60,000.00 ARS');
    expect(money(within(october).getByLabelText(/Total in USD/).textContent)).toBe('20.00 USD');
    const line = en.creditCards.detail.installmentLine
      .replace('{number}', '1')
      .replace('{count}', '12')
      .replace('{amount}', '10,000.00 ARS');
    expect(within(october).getByText((text) => money(text) === line)).toBeDefined();
  });

  it('asks for confirmation, deletes the purchase and reloads the list (AC-09)', async () => {
    const { calls } = stubApi(
      detailRoutes([purchase()], PENDING_11, {
        [`DELETE ${CARD_PATH}/installment-purchases/${PURCHASE_ID}`]: { status: 204 },
        [`GET ${CARD_PATH}/installment-purchases`]: [
          { status: 200, body: { items: [purchase()], pendingDebt: PENDING_11 } },
          { status: 200, body: { items: [], pendingDebt: { ARS: '0', USD: '0' } } },
        ],
      }),
    );
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('button', { name: en.creditCards.installments.delete }),
    );
    expect(screen.getByText(en.creditCards.installments.deleteHint)).toBeDefined();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    await user.click(
      screen.getByRole('button', { name: en.creditCards.installments.confirmDelete }),
    );

    expect(await screen.findByText(en.creditCards.installments.empty)).toBeDefined();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });

  it('cancels the confirmation without deleting anything', async () => {
    const { calls } = stubApi(detailRoutes([purchase()]));
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('button', { name: en.creditCards.installments.delete }),
    );
    await user.click(screen.getByRole('button', { name: en.creditCards.installments.cancel }));

    expect(screen.getByRole('button', { name: en.creditCards.installments.delete })).toBeDefined();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('keeps the purchase listed and shows the error when the delete fails (sad path)', async () => {
    stubApi(
      detailRoutes([purchase()], PENDING_11, {
        [`DELETE ${CARD_PATH}/installment-purchases/${PURCHASE_ID}`]: 'network-error',
      }),
    );
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('button', { name: en.creditCards.installments.delete }),
    );
    await user.click(
      screen.getByRole('button', { name: en.creditCards.installments.confirmDelete }),
    );

    expect((await screen.findByRole('alert')).textContent).toBe(en.errors.network);
    expect(screen.getByRole('listitem', { name: 'Heladera' })).toBeDefined();
  });

  it('shows the not-found state when the purchase list answers 404 (sad path)', async () => {
    stubApi(
      detailRoutes([], PENDING_11, {
        [`GET ${CARD_PATH}/installment-purchases`]: { status: 404, body: { code: 'NOT_FOUND' } },
      }),
    );
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });

    expect(await screen.findByText(en.creditCards.detail.notFound)).toBeDefined();
  });
});

describe('the installment catalogs', () => {
  it('have the same keys in Spanish and English', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
        : [prefix];
    expect(keys(es.creditCards.installments).sort()).toEqual(
      keys(en.creditCards.installments).sort(),
    );
  });
});
