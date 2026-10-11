// @vitest-environment happy-dom
import type { CreditCardResponse } from '@pesly/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CardExpenseContainer } from '../src/features/credit-cards/containers/card-expense-container';
import { category, page, uuid } from './support/category-fixtures';
import { CATALOGS, renderApp, stubApi, type ApiCall } from './support/render-app';

const { es, en } = CATALOGS;

/** 12:30 in Buenos Aires (UTC-3). */
const NOW = '2026-10-02T15:30:00.000Z';
const ID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const CARD = `GET /credit-cards/${ID}`;
const PROFILE = 'GET /profile';
const CATEGORIES = 'GET /categories?kind=expense&archived=false&limit=100';
const POST = `POST /credit-cards/${ID}/expenses`;
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
  createdAt: '2026-10-01T12:00:00.000Z',
};

const SAVED = {
  movementId: uuid(99),
  accountId: card.usdAccountId,
  currency: 'USD',
  amount: '1599',
  occurredAt: NOW,
  statementId: uuid(98),
};

function routes(overrides: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
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
    [POST]: { status: 201, body: SAVED },
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

async function open(answers = routes(), locale: 'es' | 'en' = 'es') {
  const stub = stubApi(answers);
  const view = renderApp(<CardExpenseContainer cardId={ID} />, { locale });
  await screen.findByLabelText(CATALOGS[locale].creditCards.expense.fields.amount);
  return { ...stub, ...view };
}

const field = (name: string) => screen.getByLabelText<HTMLInputElement>(name);
const submit = () => screen.getByRole('button', { name: es.creditCards.expense.submit });

async function fill(amount: string) {
  const user = userEvent.setup();
  await user.selectOptions(field(es.creditCards.expense.fields.currency), 'USD');
  await user.selectOptions(field(es.creditCards.expense.fields.category), COMIDA_ID);
  if (amount !== '') await user.type(field(es.creditCards.expense.fields.amount), amount);
  return user;
}

describe('CardExpenseContainer', () => {
  it('posts a USD expense to the card route and returns to the card page (AC-01)', async () => {
    const { calls, router } = await open();
    const user = await fill('15,99');
    await user.click(submit());

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/es/cards/${ID}`);
    });
    expect(posts(calls)).toEqual([
      {
        method: 'POST',
        path: `/credit-cards/${ID}/expenses`,
        body: {
          currency: 'USD',
          categoryId: COMIDA_ID,
          amount: '1599',
          occurredAt: NOW,
          rate: { source: 'automatic' },
        },
      },
    ]);
  });

  it('loads only open expense categories and never shows the card accounts', async () => {
    await open();

    expect(screen.getByRole('option', { name: 'Comida' })).toBeDefined();
    expect(screen.queryByRole('option', { name: 'Vieja' })).toBeNull();
    expect(screen.queryByText(card.arsAccountId)).toBeNull();
  });

  it('shows the amount message and sends nothing when the amount is empty (FR-01)', async () => {
    const { calls } = await open();
    const user = await fill('');
    await user.click(submit());

    expect(await screen.findByText(es.movements.errors.amountInvalid)).toBeDefined();
    expect(posts(calls)).toEqual([]);
    expect(document.activeElement).toBe(field(es.creditCards.expense.fields.amount));
  });

  it('shows the currency message when no currency is chosen (invalid input)', async () => {
    const { calls } = await open();
    const user = userEvent.setup();
    await user.selectOptions(field(es.creditCards.expense.fields.category), COMIDA_ID);
    await user.type(field(es.creditCards.expense.fields.amount), '10');
    await user.click(submit());

    expect(await screen.findByText(es.creditCards.expense.errors.currencyRequired)).toBeDefined();
    expect(posts(calls)).toEqual([]);
  });

  it('shows the not-found state when the card answers 404 (sad path)', async () => {
    stubApi(routes({ [CARD]: { status: 404, body: { code: 'NOT_FOUND' } } }));
    renderApp(<CardExpenseContainer cardId={ID} />);

    expect(await screen.findByText(es.creditCards.expense.notFound)).toBeDefined();
  });

  it('shows the not-found state when the save answers 404 (sad path)', async () => {
    await open(routes({ [POST]: { status: 404, body: { code: 'NOT_FOUND' } } }));
    const user = await fill('10');
    await user.click(submit());

    expect(await screen.findByText(es.creditCards.expense.notFound)).toBeDefined();
  });

  it('shows RATE_REQUIRED and keeps the typed values (sad path)', async () => {
    await open(routes({ [POST]: { status: 400, body: { code: 'RATE_REQUIRED' } } }));
    const user = await fill('15,99');
    await user.click(submit());

    expect((await screen.findByRole('alert')).textContent).toBe(es.errors.rateRequired);
    expect(field(es.creditCards.expense.fields.amount).value).toBe('15,99');
    expect(field(es.creditCards.expense.fields.currency).value).toBe('USD');
    expect(field(es.creditCards.expense.fields.category).value).toBe(COMIDA_ID);
  });

  it('shows the write limit with the Retry-After seconds and keeps the values (sad path)', async () => {
    await open(
      routes({
        [POST]: { status: 429, body: { code: 'RATE_LIMITED' }, headers: { 'Retry-After': '42' } },
      }),
    );
    const user = await fill('15,99');
    await user.click(submit());

    expect((await screen.findByRole('alert')).textContent).toBe(
      es.movements.errors.rateLimited.replace('{seconds}', '42'),
    );
    expect(field(es.creditCards.expense.fields.amount).value).toBe('15,99');
  });

  it('shows the connection-needed message and keeps the values on a network failure (sad path)', async () => {
    await open(routes({ [POST]: 'network-error' }));
    const user = await fill('15,99');
    await user.click(submit());

    expect((await screen.findByRole('alert')).textContent).toBe(
      es.creditCards.expense.connectionNeeded,
    );
    expect(field(es.creditCards.expense.fields.amount).value).toBe('15,99');
    expect(field(es.creditCards.expense.fields.currency).value).toBe('USD');
  });

  it('redirects to sign in when the save answers 401 (sad path)', async () => {
    const { router } = await open(
      routes({
        [POST]: { status: 401, body: { code: 'UNAUTHENTICATED' } },
        'POST /auth/refresh': { status: 401, body: { code: 'UNAUTHENTICATED' } },
      }),
    );
    const user = await fill('10');
    await user.click(submit());

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/es/sign-in');
    });
  });

  it('renders in Spanish and in English, with a back link to the card page', async () => {
    await open();
    expect(screen.getByRole('heading', { name: es.creditCards.expense.title })).toBeDefined();
    expect(
      screen.getByRole('link', { name: es.creditCards.expense.back }).getAttribute('href'),
    ).toBe(`/es/cards/${ID}`);
  });

  it('renders in English', async () => {
    await open(routes(), 'en');
    expect(screen.getByRole('heading', { name: en.creditCards.expense.title })).toBeDefined();
    expect(screen.getByLabelText(en.creditCards.expense.fields.category)).toBeDefined();
  });
});

describe('card expense catalogs', () => {
  it.each(['es', 'en'] as const)('has the screen strings in %s', (locale) => {
    const { expense } = CATALOGS[locale].creditCards;
    for (const value of [
      expense.title,
      expense.description,
      expense.fields.currency,
      expense.fields.currencyPlaceholder,
      expense.fields.amount,
      expense.fields.category,
      expense.fields.categoryPlaceholder,
      expense.fields.occurredAt,
      expense.fields.note,
      expense.submit,
      expense.pending,
      expense.back,
      expense.connectionNeeded,
      expense.notFound,
      expense.errors.currencyRequired,
    ]) {
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
