// @vitest-environment happy-dom
import type { CreditCardResponse, StatementResponse } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CreditCardDetailContainer } from '../src/features/credit-cards/containers/credit-card-detail-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en } = CATALOGS;
const NBSP = String.fromCharCode(0xa0);
/** Testing Library collapses whitespace (the non-breaking space included) in accessible names. */
const label = (template: string, amount: string) =>
  template.replace('{amount}', amount).replace(NBSP, ' ');
const ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const CARD_PATH = `/credit-cards/${ID}`;
const STATEMENTS_PATH = `${CARD_PATH}/statements`;
const PURCHASES_PATH = `${CARD_PATH}/installment-purchases`;
const NO_PURCHASES = {
  status: 200,
  body: { items: [], pendingDebt: { ARS: '0', USD: '0' } },
} as const;

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
const ACCOUNTS_PATH = 'GET /accounts?archived=false&limit=100';
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
} as const;

function statement(overrides: Partial<StatementResponse>): StatementResponse {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    cardId: ID,
    period: '2026-10',
    closingDate: '2026-10-24',
    dueDate: '2026-11-05',
    status: 'open',
    totals: { ARS: '0', USD: '0' },
    installments: [],
    payments: null,
    ...overrides,
  };
}

const OCTOBER = statement({});
const SEPTEMBER = statement({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  period: '2026-09',
  closingDate: '2026-09-24',
  dueDate: '2026-10-05',
  status: 'closed',
});

const day = (date: string) =>
  new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
const month = (period: string) =>
  new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${period}-01T00:00:00Z`),
  );

const loaded = (statements: StatementResponse[] = [OCTOBER, SEPTEMBER]) => ({
  [`GET ${CARD_PATH}`]: { status: 200, body: card },
  [`GET ${STATEMENTS_PATH}`]: { status: 200, body: { items: statements } },
  [`GET ${PURCHASES_PATH}`]: NO_PURCHASES,
  [ACCOUNTS_PATH]: NO_ACCOUNTS,
});

describe('CreditCardDetailContainer', () => {
  it('shows the statements with locale dates and open or closed badges (AC-04, AC-09)', async () => {
    stubApi(loaded());
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });

    const october = await screen.findByRole('listitem', { name: month('2026-10') });
    expect(within(october).getByText(en.creditCards.detail.open)).toBeDefined();
    expect(
      within(october).getByText(en.creditCards.detail.closes.replace('{date}', day('2026-10-24'))),
    ).toBeDefined();
    expect(
      within(october).getByText(en.creditCards.detail.due.replace('{date}', day('2026-11-05'))),
    ).toBeDefined();
    const september = screen.getByRole('listitem', { name: month('2026-09') });
    expect(within(september).getByText(en.creditCards.detail.closed)).toBeDefined();
  });

  it('shows both totals of a statement with 50,000.00 ARS and 20.00 USD in English (AC-05)', async () => {
    stubApi(loaded([statement({ totals: { ARS: '5000000', USD: '2000' } })]));
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });

    const october = await screen.findByRole('listitem', { name: month('2026-10') });
    const ars = within(october).getByLabelText(
      label(en.creditCards.detail.totalArs, `50,000.00${NBSP}ARS`),
    );
    expect(ars.textContent).toBe(`50,000.00${NBSP}ARS`);
    const usd = within(october).getByLabelText(
      label(en.creditCards.detail.totalUsd, `20.00${NBSP}USD`),
    );
    expect(usd.textContent).toBe(`20.00${NBSP}USD`);
  });

  it('shows both totals in Spanish with the Spanish separators (AC-05)', async () => {
    stubApi(loaded([statement({ totals: { ARS: '5000000', USD: '2000' } })]));
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'es' });

    const items = await screen.findAllByRole('listitem');
    const row = items.find((item) => item.textContent.includes('50.000,00'));
    expect(row).toBeDefined();
    if (!row) return;
    const { es } = CATALOGS;
    expect(
      within(row).getByLabelText(label(es.creditCards.detail.totalArs, `50.000,00${NBSP}ARS`))
        .textContent,
    ).toBe(`50.000,00${NBSP}ARS`);
    expect(
      within(row).getByLabelText(label(es.creditCards.detail.totalUsd, `20,00${NBSP}USD`))
        .textContent,
    ).toBe(`20,00${NBSP}USD`);
  });

  it('shows zero in both currencies for a statement with no purchases (FR-03)', async () => {
    stubApi(loaded([OCTOBER]));
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });

    const october = await screen.findByRole('listitem', { name: month('2026-10') });
    expect(
      within(october).getByLabelText(label(en.creditCards.detail.totalArs, `0.00${NBSP}ARS`))
        .textContent,
    ).toBe(`0.00${NBSP}ARS`);
    expect(
      within(october).getByLabelText(label(en.creditCards.detail.totalUsd, `0.00${NBSP}USD`))
        .textContent,
    ).toBe(`0.00${NBSP}USD`);
  });

  it('links the card page to the unified purchase screen of the card (FR-01)', async () => {
    stubApi(loaded());
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });

    const link = await screen.findByRole('link', { name: en.creditCards.detail.addPurchase });
    expect(link.getAttribute('href')).toBe(`/en/cards/${ID}/installments/new`);
  });

  it('shows the load-failure state when a statement comes without totals (error path)', async () => {
    const withoutTotals: Omit<StatementResponse, 'totals'> & { totals?: unknown } = { ...OCTOBER };
    delete withoutTotals.totals;
    stubApi({
      [`GET ${CARD_PATH}`]: { status: 200, body: card },
      [`GET ${STATEMENTS_PATH}`]: { status: 200, body: { items: [withoutTotals] } },
      [`GET ${PURCHASES_PATH}`]: NO_PURCHASES,
      [ACCOUNTS_PATH]: NO_ACCOUNTS,
    });
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });

    expect(await screen.findByRole('button', { name: en.app.retry })).toBeDefined();
    expect(screen.queryByRole('listitem', { name: month('2026-10') })).toBeNull();
  });

  it('moves the open statement closing date and shows the saved date (AC-06)', async () => {
    const moved = statement({ closingDate: '2026-10-26' });
    const { calls } = stubApi({
      ...loaded(),
      [`PATCH ${STATEMENTS_PATH}/${OCTOBER.id}`]: { status: 200, body: moved },
    });
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    const october = await screen.findByRole('listitem', { name: month('2026-10') });
    await user.click(within(october).getByRole('button', { name: en.creditCards.detail.edit }));
    const closing = within(october).getByLabelText(en.creditCards.detail.closingDate);
    await user.clear(closing);
    await user.type(closing, '2026-10-26');
    await user.click(within(october).getByRole('button', { name: en.creditCards.detail.save }));

    expect(
      await within(october).findByText(
        en.creditCards.detail.closes.replace('{date}', day('2026-10-26')),
      ),
    ).toBeDefined();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      closingDate: '2026-10-26',
      dueDate: '2026-11-05',
    });
  });

  it('offers no edit on a closed statement and explains a 409 STATEMENT_CLOSED (sad path, AC-07)', async () => {
    stubApi({
      ...loaded(),
      [`PATCH ${STATEMENTS_PATH}/${OCTOBER.id}`]: {
        status: 409,
        body: { code: 'STATEMENT_CLOSED' },
      },
    });
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    const september = await screen.findByRole('listitem', { name: month('2026-09') });
    expect(within(september).queryByRole('button')).toBeNull();
    const october = screen.getByRole('listitem', { name: month('2026-10') });
    await user.click(within(october).getByRole('button', { name: en.creditCards.detail.edit }));
    await user.click(within(october).getByRole('button', { name: en.creditCards.detail.save }));

    expect(await screen.findByText(en.errors.statementClosed)).toBeDefined();
  });

  it('shows the dates message for a 400 on the statement (invalid input)', async () => {
    stubApi({
      ...loaded(),
      [`PATCH ${STATEMENTS_PATH}/${OCTOBER.id}`]: {
        status: 400,
        body: { code: 'VALIDATION_FAILED', fields: ['body.closingDate'] },
      },
    });
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    const october = await screen.findByRole('listitem', { name: month('2026-10') });
    await user.click(within(october).getByRole('button', { name: en.creditCards.detail.edit }));
    await user.click(within(october).getByRole('button', { name: en.creditCards.detail.save }));

    expect(await screen.findByText(en.creditCards.detail.datesInvalid)).toBeDefined();
  });

  it('changes the closing day to 20 and loads the statements again (AC-08)', async () => {
    const { calls } = stubApi({
      [`GET ${CARD_PATH}`]: { status: 200, body: card },
      [`GET ${STATEMENTS_PATH}`]: [
        { status: 200, body: { items: [OCTOBER] } },
        { status: 200, body: { items: [statement({ closingDate: '2026-10-20' })] } },
      ],
      [`GET ${PURCHASES_PATH}`]: NO_PURCHASES,
      [ACCOUNTS_PATH]: NO_ACCOUNTS,
      [`PATCH ${CARD_PATH}`]: { status: 200, body: { ...card, closingDay: 20 } },
    });
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    const closingDay = await screen.findByLabelText(en.creditCards.form.closingDay);
    await user.clear(closingDay);
    await user.type(closingDay, '20');
    await user.click(screen.getByRole('button', { name: en.creditCards.detail.saveDays }));

    expect(
      await screen.findByText(en.creditCards.detail.closes.replace('{date}', day('2026-10-20'))),
    ).toBeDefined();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ closingDay: 20, dueDay: 5 });
  });

  it('refuses day 0 without sending it (invalid input)', async () => {
    const { calls } = stubApi(loaded());
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    const dueDay = await screen.findByLabelText(en.creditCards.form.dueDay);
    await user.clear(dueDay);
    await user.type(dueDay, '0');
    await user.click(screen.getByRole('button', { name: en.creditCards.detail.saveDays }));

    expect(await screen.findByText(en.creditCards.errors.dayInvalid)).toBeDefined();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('deletes the card after confirming and returns to the list (FR-08)', async () => {
    stubApi({ ...loaded(), [`DELETE ${CARD_PATH}`]: { status: 204 } });
    const { router } = renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: en.creditCards.detail.delete }));
    expect(
      screen.getByText(en.creditCards.detail.confirmDelete.replace('{name}', 'Visa')),
    ).toBeDefined();
    await user.click(screen.getByRole('button', { name: en.creditCards.detail.confirm }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/en/cards');
    });
  });

  it('explains a 409 CARD_HAS_MOVEMENTS and keeps the card (sad path, D1)', async () => {
    stubApi({
      ...loaded(),
      [`DELETE ${CARD_PATH}`]: { status: 409, body: { code: 'CARD_HAS_MOVEMENTS' } },
    });
    const { router } = renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: en.creditCards.detail.delete }));
    await user.click(screen.getByRole('button', { name: en.creditCards.detail.confirm }));

    expect(await screen.findByText(en.errors.cardHasMovements)).toBeDefined();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("shows the not-found state for a card that is not the user's (sad path, AC-10)", async () => {
    stubApi({
      [`GET ${CARD_PATH}`]: { status: 404, body: { code: 'NOT_FOUND' } },
      [`GET ${STATEMENTS_PATH}`]: { status: 404, body: { code: 'NOT_FOUND' } },
    });
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });

    expect(await screen.findByText(en.creditCards.detail.notFound)).toBeDefined();
    expect(
      screen.getByRole('link', { name: en.creditCards.detail.back }).getAttribute('href'),
    ).toBe('/en/cards');
  });

  it('shows the error state with a retry on a failed load (error path)', async () => {
    stubApi({
      [`GET ${CARD_PATH}`]: [
        { status: 500, body: { code: 'INTERNAL' } },
        { status: 200, body: card },
      ],
      [`GET ${STATEMENTS_PATH}`]: { status: 200, body: { items: [OCTOBER] } },
      [`GET ${PURCHASES_PATH}`]: NO_PURCHASES,
      [ACCOUNTS_PATH]: NO_ACCOUNTS,
    });
    renderApp(<CreditCardDetailContainer cardId={ID} />, { locale: 'en' });

    await userEvent.setup().click(await screen.findByRole('button', { name: en.app.retry }));

    expect(await screen.findByRole('listitem', { name: month('2026-10') })).toBeDefined();
  });
});
