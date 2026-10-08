// @vitest-environment happy-dom
import type { AccountResponse, CreditCardResponse, StatementResponse } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreditCardDetailContainer } from '../src/features/credit-cards/containers/credit-card-detail-container';
import { StatementPaymentContainer } from '../src/features/credit-cards/containers/statement-payment-container';
import { CATALOGS, renderApp, stubApi, type ApiCall } from './support/render-app';

const { es, en } = CATALOGS;

/** 12:30 in Buenos Aires (UTC-3). */
const NOW = '2026-10-02T15:30:00.000Z';
const ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const CARD_PATH = `/credit-cards/${ID}`;
const CARD = `GET ${CARD_PATH}`;
const PROFILE = 'GET /profile';
const ACCOUNTS = 'GET /accounts?archived=false&limit=100';
const POST = `POST ${CARD_PATH}/payments`;
const BANK_ID = '00000000-0000-4000-8000-000000000031';
const USD_BANK_ID = '00000000-0000-4000-8000-000000000032';
/** Testing Library collapses whitespace (the non-breaking space included) in text matches. */
const NBSP = ' ';

const card: CreditCardResponse = {
  id: ID,
  name: 'Visa',
  closingDay: 24,
  dueDay: 5,
  arsAccountId: '11111111-1111-4111-8111-111111111111',
  usdAccountId: '22222222-2222-4222-8222-222222222222',
  createdAt: '2026-10-01T12:00:00.000Z',
};

function account(overrides: Partial<AccountResponse>): AccountResponse {
  return {
    id: BANK_ID,
    name: 'Banco',
    type: 'bank_account',
    currency: 'ARS',
    openingBalance: '0',
    balance: '0',
    includeInAvailable: true,
    archived: false,
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function accountPage(items: AccountResponse[]) {
  return {
    status: 200,
    body: {
      items,
      availableTotals: { ARS: '0', USD: '0' },
      netWorthTotals: { ARS: '0', USD: '0' },
      debtTotals: { ARS: '0', USD: '0' },
      creditCardCount: 0,
      total: items.length,
      limit: 100,
      offset: 0,
    },
  };
}

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
    [ACCOUNTS]: accountPage([
      account({ id: BANK_ID, name: 'Banco' }),
      account({ id: USD_BANK_ID, name: 'Banco dólares', currency: 'USD' }),
      account({ id: card.arsAccountId, name: 'Visa ARS', type: 'credit_card' }),
      account({ id: '44444444-4444-4444-8444-444444444444', name: 'Vieja', archived: true }),
    ]),
    [POST]: {
      status: 201,
      body: {
        movementId: '5a1d2c34-1e5f-4a67-8b90-0c1d2e3f4a5b',
        sourceAccountId: BANK_ID,
        accountId: card.arsAccountId,
        currency: 'ARS',
        amount: '6000000',
        exchange: null,
        occurredAt: NOW,
      },
    },
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
const t = es.creditCards.payments;

async function open(answers = formRoutes(), locale: 'es' | 'en' = 'es') {
  const stub = stubApi(answers);
  const view = renderApp(<StatementPaymentContainer cardId={ID} />, { locale });
  await screen.findByLabelText(CATALOGS[locale].creditCards.payments.fields.amount);
  return { ...stub, ...view };
}

const field = (name: string) => screen.getByLabelText<HTMLInputElement>(name);
const submit = () => screen.getByRole('button', { name: t.submit });

describe('StatementPaymentContainer', () => {
  it('posts 60.000,00 ARS from the bank account and returns to the card page (AC-01)', async () => {
    const { calls, router } = await open();
    const user = userEvent.setup();
    await user.selectOptions(field(t.fields.sourceAccount), BANK_ID);
    await user.type(field(t.fields.amount), '60000');
    await user.click(submit());

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/es/cards/${ID}`);
    });
    expect(posts(calls)).toEqual([
      {
        method: 'POST',
        path: `${CARD_PATH}/payments`,
        body: {
          currency: 'ARS',
          sourceAccountId: BANK_ID,
          amount: '6000000',
          occurredAt: NOW,
        },
      },
    ]);
  });

  it('offers only ARS accounts for an ARS payment and every open account for a USD one, never the card own (AC-02)', async () => {
    await open();
    const user = userEvent.setup();

    expect(screen.getByRole('option', { name: 'Banco' })).toBeDefined();
    expect(screen.queryByRole('option', { name: 'Banco dólares' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Visa ARS' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Vieja' })).toBeNull();
    await user.selectOptions(field(t.fields.currency), 'USD');
    expect(screen.getByRole('option', { name: 'Banco dólares' })).toBeDefined();
    expect(screen.getByRole('option', { name: 'Banco' })).toBeDefined();
    expect(screen.queryByRole('option', { name: 'Vieja' })).toBeNull();
  });

  it('pays USD from a USD account as today, without the pesos field', async () => {
    const { calls } = await open();
    const user = userEvent.setup();
    await user.selectOptions(field(t.fields.currency), 'USD');
    await user.selectOptions(field(t.fields.sourceAccount), USD_BANK_ID);
    expect(screen.queryByLabelText(t.fields.pesosAmount)).toBeNull();
    await user.type(field(t.fields.amount), '59,59');
    await user.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(posts(calls)[0]?.body).toEqual({
      currency: 'USD',
      sourceAccountId: USD_BANK_ID,
      amount: '5959',
      occurredAt: NOW,
    });
  });

  it('shows the pesos field and the derived rate for a USD payment from an ARS account and sends the pesos', async () => {
    const { calls } = await open();
    const user = userEvent.setup();
    await user.selectOptions(field(t.fields.currency), 'USD');
    await user.selectOptions(field(t.fields.sourceAccount), BANK_ID);
    await user.type(field(t.fields.amount), '59,59');
    await user.type(field(t.fields.pesosAmount), '91.470,65');

    expect((await screen.findByRole('status')).textContent).toBe(
      es.movements.exchange.impliedRate.replace('{rate}', '1535,0000'),
    );
    await user.click(submit());

    await waitFor(() => {
      expect(posts(calls)).toHaveLength(1);
    });
    expect(posts(calls)[0]?.body).toEqual({
      currency: 'USD',
      sourceAccountId: BANK_ID,
      amount: '5959',
      pesosAmount: '9147065',
      occurredAt: NOW,
    });
  });

  it('asks for the pesos when an ARS account pays USD and sends nothing without them (invalid input)', async () => {
    const { calls } = await open();
    const user = userEvent.setup();
    await user.selectOptions(field(t.fields.currency), 'USD');
    await user.selectOptions(field(t.fields.sourceAccount), BANK_ID);
    await user.type(field(t.fields.amount), '59,59');
    await user.click(submit());

    expect(await screen.findByText(es.movements.errors.amountInvalid)).toBeDefined();
    expect(posts(calls)).toEqual([]);
  });

  it('shows the API mismatch message as an alert and keeps the typed values (AC-02)', async () => {
    await open(
      formRoutes({ [POST]: { status: 400, body: { code: 'MOVEMENT_CURRENCY_MISMATCH' } } }),
    );
    const user = userEvent.setup();
    await user.selectOptions(field(t.fields.sourceAccount), BANK_ID);
    await user.type(field(t.fields.amount), '60000');
    await user.click(submit());

    expect((await screen.findByRole('alert')).textContent).toBe(es.errors.movementCurrencyMismatch);
    expect(field(t.fields.amount).value).toBe('60.000');
  });

  it('shows the field message for an empty amount and a missing account and sends nothing (invalid input)', async () => {
    const { calls } = await open();
    const user = userEvent.setup();
    await user.click(submit());

    expect(await screen.findByText(es.movements.errors.accountRequired)).toBeDefined();
    expect(screen.getByText(es.movements.errors.amountInvalid)).toBeDefined();
    expect(posts(calls)).toEqual([]);
  });

  it('shows the not-found state when the card answers 404 or the save answers 404 (sad path)', async () => {
    stubApi(formRoutes({ [CARD]: { status: 404, body: { code: 'NOT_FOUND' } } }));
    const first = renderApp(<StatementPaymentContainer cardId={ID} />);
    expect(await screen.findByText(t.notFound)).toBeDefined();
    first.unmount();

    await open(formRoutes({ [POST]: { status: 404, body: { code: 'NOT_FOUND' } } }));
    const user = userEvent.setup();
    await user.selectOptions(field(t.fields.sourceAccount), BANK_ID);
    await user.type(field(t.fields.amount), '1000');
    await user.click(submit());
    expect(await screen.findByText(t.notFound)).toBeDefined();
  });

  it('shows the connection-needed message and keeps the values on a network failure (sad path)', async () => {
    await open(formRoutes({ [POST]: 'network-error' }));
    const user = userEvent.setup();
    await user.selectOptions(field(t.fields.sourceAccount), BANK_ID);
    await user.type(field(t.fields.amount), '1000');
    await user.click(submit());

    expect((await screen.findByRole('alert')).textContent).toBe(t.connectionNeeded);
    expect(field(t.fields.amount).value).toBe('1.000');
  });

  it('shows the write limit with the Retry-After seconds (sad path)', async () => {
    await open(
      formRoutes({
        [POST]: { status: 429, body: { code: 'RATE_LIMITED' }, headers: { 'Retry-After': '42' } },
      }),
    );
    const user = userEvent.setup();
    await user.selectOptions(field(t.fields.sourceAccount), BANK_ID);
    await user.type(field(t.fields.amount), '1000');
    await user.click(submit());

    expect((await screen.findByRole('alert')).textContent).toBe(
      es.movements.errors.rateLimited.replace('{seconds}', '42'),
    );
  });

  it('renders in English too', async () => {
    await open(formRoutes(), 'en');
    expect(screen.getByRole('button', { name: en.creditCards.payments.submit })).toBeDefined();
  });
});

const STATEMENTS = `GET ${CARD_PATH}/statements`;
const PURCHASES = `GET ${CARD_PATH}/installment-purchases`;

function statement(overrides: Partial<StatementResponse>): StatementResponse {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    cardId: ID,
    period: '2026-09',
    closingDate: '2026-09-24',
    dueDate: '2026-10-05',
    status: 'closed',
    totals: { ARS: '6000000', USD: '0' },
    installments: [],
    payments: null,
    ...overrides,
  };
}

async function showStatement(item: StatementResponse, locale: 'es' | 'en') {
  stubApi({
    [CARD]: { status: 200, body: card },
    [STATEMENTS]: { status: 200, body: { items: [item] } },
    [PURCHASES]: { status: 200, body: { items: [], pendingDebt: { ARS: '0', USD: '0' } } },
  });
  renderApp(<CreditCardDetailContainer cardId={ID} />, { locale });
  return screen.findByRole('listitem', { name: /2026|septiembre|September/i });
}

describe('statements with payments', () => {
  const none = { paid: '0', status: 'paid' as const };

  it('shows a closed statement of 60,000.00 ARS with 60,000.00 paid as paid, in both languages (AC-03)', async () => {
    const paid = statement({
      payments: { ARS: { paid: '6000000', status: 'paid' }, USD: none },
    });
    const row = await showStatement(paid, 'en');
    expect(
      within(row).getByText(
        en.creditCards.detail.paymentLine
          .replace('{currency}', 'ARS')
          .replace('{status}', en.creditCards.detail.paymentStatus.paid)
          .replace('{amount}', `60,000.00${NBSP}ARS`),
      ),
    ).toBeDefined();
  });

  it('shows it in Spanish as pagado (AC-03)', async () => {
    const paid = statement({
      payments: { ARS: { paid: '6000000', status: 'paid' }, USD: none },
    });
    const row = await showStatement(paid, 'es');
    expect(
      within(row).getByText(
        es.creditCards.detail.paymentLine
          .replace('{currency}', 'ARS')
          .replace('{status}', es.creditCards.detail.paymentStatus.paid)
          .replace('{amount}', `60.000,00${NBSP}ARS`),
      ),
    ).toBeDefined();
  });

  it('shows a closed statement of 60,000.00 ARS with 20,000.00 paid as partially paid (AC-04)', async () => {
    const partial = statement({
      payments: { ARS: { paid: '2000000', status: 'partially_paid' }, USD: none },
    });
    const row = await showStatement(partial, 'en');
    expect(
      within(row).getByText(
        en.creditCards.detail.paymentLine
          .replace('{currency}', 'ARS')
          .replace('{status}', en.creditCards.detail.paymentStatus.partially_paid)
          .replace('{amount}', `20,000.00${NBSP}ARS`),
      ),
    ).toBeDefined();
  });

  it('shows unpaid, shows nothing for an open statement and hides a currency with nothing to pay', async () => {
    const unpaid = statement({
      payments: { ARS: { paid: '0', status: 'unpaid' }, USD: none },
    });
    const row = await showStatement(unpaid, 'en');
    expect(row.textContent).toContain(en.creditCards.detail.paymentStatus.unpaid);
    expect(row.textContent).not.toContain('USD:');
  });

  it('shows no payment line for an open statement', async () => {
    const open = statement({ status: 'open', payments: null });
    const row = await showStatement(open, 'en');
    expect(row.textContent).not.toContain(en.creditCards.detail.paymentStatus.unpaid);
    expect(row.textContent).not.toContain(en.creditCards.detail.paymentStatus.paid);
  });

  it('links the card page to the payment screen', async () => {
    await showStatement(statement({}), 'en');
    const link = screen.getByRole('link', { name: en.creditCards.detail.payStatement });
    expect(link.getAttribute('href')).toBe(`/en/cards/${ID}/payments/new`);
  });
});
