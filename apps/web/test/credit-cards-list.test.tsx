// @vitest-environment happy-dom
import type { CreditCardResponse } from '@pesly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CreateCreditCardContainer } from '../src/features/credit-cards/containers/create-credit-card-container';
import { CreditCardsContainer } from '../src/features/credit-cards/containers/credit-cards-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { es, en } = CATALOGS;

function card(overrides: Partial<CreditCardResponse> = {}): CreditCardResponse {
  return {
    id: '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10',
    name: 'Visa',
    closingDay: 24,
    dueDay: 5,
    arsAccountId: '11111111-1111-4111-8111-111111111111',
    usdAccountId: '22222222-2222-4222-8222-222222222222',
    debitArsAccountId: null,
    debitUsdAccountId: null,
    createdAt: '2026-10-06T12:00:00.000Z',
    ...overrides,
  };
}

const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );

describe('CreditCardsContainer', () => {
  it.each([
    ['es', es],
    ['en', en],
  ] as const)(
    'lists the cards with their days and a link to each (%s, AC-01, AC-11)',
    async (locale, catalog) => {
      stubApi({
        'GET /credit-cards': {
          status: 200,
          body: { items: [card(), card({ id: 'b2', name: 'Amex', closingDay: 10, dueDay: 25 })] },
        },
      });
      renderApp(<CreditCardsContainer />, { locale });

      const visa = await screen.findByRole('listitem', { name: 'Visa' });
      expect(
        within(visa).getByText(fill(catalog.creditCards.list.days, { closing: 24, due: 5 })),
      ).toBeDefined();
      expect(within(visa).getByRole('link').getAttribute('href')).toBe(
        `/${locale}/cards/3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10`,
      );
      expect(screen.getByRole('listitem', { name: 'Amex' })).toBeDefined();
      expect(screen.getByRole('link', { name: catalog.creditCards.new }).getAttribute('href')).toBe(
        `/${locale}/cards/new`,
      );
    },
  );

  it('shows the empty state with a link to create the first card', async () => {
    stubApi({ 'GET /credit-cards': { status: 200, body: { items: [] } } });
    renderApp(<CreditCardsContainer />, { locale: 'en' });

    expect(
      await screen.findByRole('heading', { name: en.creditCards.list.emptyTitle }),
    ).toBeDefined();
  });

  it('shows the error state with a retry that loads again (error path)', async () => {
    const { calls } = stubApi({
      'GET /credit-cards': [
        { status: 500, body: { code: 'INTERNAL' } },
        { status: 200, body: { items: [card()] } },
      ],
    });
    renderApp(<CreditCardsContainer />, { locale: 'en' });

    await userEvent.setup().click(await screen.findByRole('button', { name: en.app.retry }));

    expect(await screen.findByRole('listitem', { name: 'Visa' })).toBeDefined();
    expect(calls.filter((c) => c.path === '/credit-cards')).toHaveLength(2);
  });

  it('sends a signed-out user to sign in (sad path)', async () => {
    stubApi({ 'GET /credit-cards': { status: 401, body: { code: 'UNAUTHENTICATED' } } });
    const { router } = renderApp(<CreditCardsContainer />, { locale: 'en' });
    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/en/sign-in');
    });
  });
});

describe('CreateCreditCardContainer', () => {
  async function submit(values: { name?: string; closing?: string; due?: string }) {
    const user = userEvent.setup();
    const form = en.creditCards.form;
    if (values.name !== undefined) await user.type(screen.getByLabelText(form.name), values.name);
    if (values.closing !== undefined) {
      await user.type(screen.getByLabelText(form.closingDay), values.closing);
    }
    if (values.due !== undefined) await user.type(screen.getByLabelText(form.dueDay), values.due);
    await user.click(screen.getByRole('button', { name: form.submit }));
  }

  it('posts "Visa" 24/5 and returns to the list (AC-01)', async () => {
    const { calls } = stubApi({ 'POST /credit-cards': { status: 201, body: card() } });
    const { router } = renderApp(<CreateCreditCardContainer />, { locale: 'en' });

    await submit({ name: 'Visa', closing: '24', due: '5' });

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/en/cards');
    });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Visa',
      closingDay: 24,
      dueDay: 5,
    });
  });

  it('shows field messages for day 32 and an empty name and sends nothing (invalid input, AC-02)', async () => {
    const { calls } = stubApi({});
    renderApp(<CreateCreditCardContainer />, { locale: 'en' });

    await submit({ closing: '32', due: '5' });

    expect(await screen.findByText(en.creditCards.errors.dayInvalid)).toBeDefined();
    expect(screen.getByText(en.accounts.errors.nameRequired)).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it('shows the name message on 409 ACCOUNT_NAME_TAKEN (sad path)', async () => {
    stubApi({ 'POST /credit-cards': { status: 409, body: { code: 'ACCOUNT_NAME_TAKEN' } } });
    renderApp(<CreateCreditCardContainer />, { locale: 'en' });

    await submit({ name: 'Visa', closing: '24', due: '5' });

    expect(await screen.findByText(en.creditCards.errors.nameTaken)).toBeDefined();
  });

  it('keeps the typed values and shows an alert on an unexpected failure (error path)', async () => {
    stubApi({ 'POST /credit-cards': { status: 500, body: { code: 'INTERNAL' } } });
    renderApp(<CreateCreditCardContainer />, { locale: 'en' });

    await submit({ name: 'Visa', closing: '24', due: '5' });

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByLabelText(en.creditCards.form.name)).toHaveProperty('value', 'Visa');
  });
});
