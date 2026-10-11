// @vitest-environment happy-dom
import type { AccountResponse, CreditCardResponse } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CreditCardDetailContainer } from '../src/features/credit-cards/containers/credit-card-detail-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;
const ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const CARD_PATH = `/credit-cards/${ID}`;
const DEBIT_PATH = `${CARD_PATH}/debit-accounts`;
const ACCOUNTS = 'GET /accounts?archived=false&limit=100';
const GALICIA = '33333333-3333-4333-8333-333333333333';
const DOLARES = '44444444-4444-4444-8444-444444444444';
const ARCHIVED = '55555555-5555-4555-8555-555555555555';

const card: CreditCardResponse = {
  id: ID,
  name: 'Visa',
  closingDay: 24,
  dueDay: 5,
  arsAccountId: '11111111-1111-4111-8111-111111111111',
  usdAccountId: '22222222-2222-4222-8222-222222222222',
  debitArsAccountId: null,
  debitUsdAccountId: null,
  createdAt: '2026-10-06T12:00:00.000Z',
};

function account(overrides: Partial<AccountResponse>): AccountResponse {
  return {
    id: GALICIA,
    name: 'Galicia',
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

const ACCOUNT_LIST = [
  account({}),
  account({ id: DOLARES, name: 'Dolares', currency: 'USD' }),
  account({ id: ARCHIVED, name: 'Vieja', archived: true }),
  account({ id: card.arsAccountId, name: 'Visa ARS', type: 'credit_card' }),
  account({ id: card.usdAccountId, name: 'Visa USD', type: 'credit_card', currency: 'USD' }),
];

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

function loaded(saved: CreditCardResponse = card) {
  return {
    [`GET ${CARD_PATH}`]: { status: 200, body: saved },
    [`GET ${CARD_PATH}/statements`]: { status: 200, body: { items: [] } },
    [`GET ${CARD_PATH}/installment-purchases`]: {
      status: 200,
      body: { items: [], pendingDebt: { ARS: '0', USD: '0' } },
    },
    [ACCOUNTS]: accountPage(ACCOUNT_LIST),
  };
}

const arsSelect = () => screen.findByLabelText(en.creditCards.detail.debitArs);
const usdSelect = () => screen.findByLabelText(en.creditCards.detail.debitUsd);
const optionNames = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.textContent);
const saveButton = () => screen.getByRole('button', { name: en.creditCards.detail.debitSave });

describe('automatic debit section of the card page', () => {
  it('saves an ARS bank account and shows it as the saved link (AC-01)', async () => {
    const saved = { ...card, debitArsAccountId: GALICIA };
    const { calls } = stubApi({ ...loaded(), [`PUT ${DEBIT_PATH}`]: { status: 200, body: saved } });
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    await user.selectOptions(await arsSelect(), GALICIA);
    await user.click(saveButton());

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        debitArsAccountId: GALICIA,
        debitUsdAccountId: null,
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>(en.creditCards.detail.debitArs).value).toBe(
        GALICIA,
      );
    });
  });

  it('preselects the saved link and lists only open non-card accounts of each currency (AC-02)', async () => {
    stubApi(loaded({ ...card, debitUsdAccountId: DOLARES }));
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });

    const ars = await arsSelect();
    const usd = await usdSelect();

    expect(optionNames(ars)).toEqual([en.creditCards.detail.debitNone, 'Galicia']);
    expect(optionNames(usd)).toEqual([en.creditCards.detail.debitNone, 'Dolares']);
    expect((usd as HTMLSelectElement).value).toBe(DOLARES);
    expect((ars as HTMLSelectElement).value).toBe('');
  });

  it('sends null for "None" and shows no debit account for that currency (AC-04)', async () => {
    const { calls } = stubApi({
      ...loaded({ ...card, debitArsAccountId: GALICIA }),
      [`PUT ${DEBIT_PATH}`]: { status: 200, body: card },
    });
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    const ars = await arsSelect();
    expect((ars as HTMLSelectElement).value).toBe(GALICIA);
    await user.selectOptions(ars, '');
    await user.click(saveButton());

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        debitArsAccountId: null,
        debitUsdAccountId: null,
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText<HTMLSelectElement>(en.creditCards.detail.debitArs).value).toBe(
        '',
      );
    });
  });

  it.each([
    ['DEBIT_ACCOUNT_CURRENCY_MISMATCH', 400, en.errors.debitAccountCurrencyMismatch],
    ['DEBIT_ACCOUNT_IS_CARD_ACCOUNT', 400, en.errors.debitAccountIsCardAccount],
    ['ACCOUNT_ARCHIVED', 409, en.errors.accountArchived],
  ])(
    'shows a %s answer as an alert and keeps the selection (sad path, AC-05, FR-04)',
    async (code, status, message) => {
      stubApi({ ...loaded(), [`PUT ${DEBIT_PATH}`]: { status, body: { code } } });
      renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
      const user = userEvent.setup();

      await user.selectOptions(await arsSelect(), GALICIA);
      await user.click(saveButton());

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(message);
      expect(screen.getByLabelText<HTMLSelectElement>(en.creditCards.detail.debitArs).value).toBe(
        GALICIA,
      );
    },
  );

  it('shows the not-found state on a 404 (sad path, FR-01)', async () => {
    stubApi({
      ...loaded(),
      [`PUT ${DEBIT_PATH}`]: { status: 404, body: { code: 'NOT_FOUND' } },
    });
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    await user.selectOptions(await arsSelect(), GALICIA);
    await user.click(saveButton());

    expect(await screen.findByText(en.creditCards.detail.notFound)).toBeDefined();
  });

  it('keeps the typed selection and asks for a connection on a network failure (sad path, FR-01)', async () => {
    stubApi({ ...loaded(), [`PUT ${DEBIT_PATH}`]: 'network-error' });
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    await user.selectOptions(await arsSelect(), GALICIA);
    await user.click(saveButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(en.creditCards.detail.debitConnectionNeeded);
    expect(screen.getByLabelText<HTMLSelectElement>(en.creditCards.detail.debitArs).value).toBe(
      GALICIA,
    );
  });

  it('redirects to sign-in on an unauthenticated save (sad path)', async () => {
    stubApi({
      ...loaded(),
      [`PUT ${DEBIT_PATH}`]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
      'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
    });
    const { router } = renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    await user.selectOptions(await arsSelect(), GALICIA);
    await user.click(saveButton());

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/sign-in');
    });
  });

  it('shows the load state with a retry when the accounts fail to load (error path)', async () => {
    stubApi({ ...loaded(), [ACCOUNTS]: { status: 500, body: { code: 'INTERNAL' } } });
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });

    expect(await screen.findByRole('button', { name: en.app.retry })).toBeDefined();
    expect(screen.queryByLabelText(en.creditCards.detail.debitArs)).toBeNull();
  });

  it('renders the section in Spanish with its note (FR-01)', async () => {
    stubApi(loaded());
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'es' });

    expect(await screen.findByLabelText(es.creditCards.detail.debitArs)).toBeDefined();
    expect(screen.getByLabelText(es.creditCards.detail.debitUsd)).toBeDefined();
    expect(screen.getByRole('heading', { name: es.creditCards.detail.debitTitle })).toBeDefined();
    expect(screen.getByText(es.creditCards.detail.debitNote)).toBeDefined();
  });

  it('renders the section in English with labelled selects and a visible error text (FR-01)', async () => {
    stubApi({
      ...loaded(),
      [`PUT ${DEBIT_PATH}`]: { status: 400, body: { code: 'DEBIT_ACCOUNT_IS_CARD_ACCOUNT' } },
    });
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    const ars = await arsSelect();
    expect(ars.tagName).toBe('SELECT');
    expect((await usdSelect()).tagName).toBe('SELECT');
    expect(screen.getByRole('heading', { name: en.creditCards.detail.debitTitle })).toBeDefined();
    expect(screen.getByText(en.creditCards.detail.debitNote)).toBeDefined();
    await user.click(saveButton());

    // The error is text inside an alert, not only a color.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(en.errors.debitAccountIsCardAccount);
  });
});
