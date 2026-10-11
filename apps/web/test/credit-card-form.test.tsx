// @vitest-environment happy-dom
import type { CreditCardResponse } from '@pesly/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CreateCreditCardContainer } from '../src/features/credit-cards/containers/create-credit-card-container';
import { CATALOGS, renderApp, stubApi } from './support/render-app';

const { en, es } = CATALOGS;

const created: CreditCardResponse = {
  id: '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10',
  name: 'Visa',
  closingDay: 24,
  dueDay: 5,
  arsAccountId: '11111111-1111-4111-8111-111111111111',
  usdAccountId: '22222222-2222-4222-8222-222222222222',
  debitArsAccountId: null,
  debitUsdAccountId: null,
  reminderDays: 3,
  createdAt: '2026-10-06T12:00:00.000Z',
};

async function fillAndSubmit(reminder?: string) {
  const user = userEvent.setup();
  const form = en.creditCards.form;
  await user.type(screen.getByLabelText(form.name), 'Visa');
  await user.type(screen.getByLabelText(form.closingDay), '24');
  await user.type(screen.getByLabelText(form.dueDay), '5');
  if (reminder !== undefined) {
    const field = screen.getByLabelText(form.reminderDays);
    await user.clear(field);
    if (reminder !== '') await user.type(field, reminder);
  }
  await user.click(screen.getByRole('button', { name: form.submit }));
}

describe('CreditCardForm reminder days', () => {
  it('starts the reminder days at 3 and shows the hint (AC-02)', () => {
    stubApi({});
    renderApp(<CreateCreditCardContainer />, { locale: 'en' });

    expect(screen.getByLabelText(en.creditCards.form.reminderDays)).toHaveProperty('value', '3');
    expect(screen.getByText(en.creditCards.form.reminderDaysHint)).toBeDefined();
  });

  it('sends the default 3 when the field is left alone (AC-02)', async () => {
    const { calls } = stubApi({ 'POST /credit-cards': { status: 201, body: created } });
    renderApp(<CreateCreditCardContainer />, { locale: 'en' });

    await fillAndSubmit();

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: 'Visa',
        closingDay: 24,
        dueDay: 5,
        reminderDays: 3,
      });
    });
  });

  it('typing 7 sends reminderDays 7 with the card (AC-02)', async () => {
    const { calls } = stubApi({
      'POST /credit-cards': { status: 201, body: { ...created, reminderDays: 7 } },
    });
    renderApp(<CreateCreditCardContainer />, { locale: 'en' });

    await fillAndSubmit('7');

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: 'Visa',
        closingDay: 24,
        dueDay: 5,
        reminderDays: 7,
      });
    });
  });

  it('an empty field means the default 3 on create (AC-02)', async () => {
    const { calls } = stubApi({ 'POST /credit-cards': { status: 201, body: created } });
    renderApp(<CreateCreditCardContainer />, { locale: 'en' });

    await fillAndSubmit('');

    await waitFor(() => {
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ reminderDays: 3 });
    });
  });

  it.each(['-1', '31', '2.5'])(
    'typing %s shows the visible field error and sends no request (sad path, AC-03)',
    async (typed) => {
      const { calls } = stubApi({});
      renderApp(<CreateCreditCardContainer />, { locale: 'en' });

      await fillAndSubmit(typed);

      const message = await screen.findByText(en.creditCards.errors.reminderDaysInvalid);
      expect(message.textContent).toBe(en.creditCards.errors.reminderDaysInvalid);
      expect(
        screen.getByLabelText(en.creditCards.form.reminderDays).getAttribute('aria-invalid'),
      ).toBe('true');
      expect(calls).toHaveLength(0);
    },
  );

  it('renders the field label and hint in Spanish (FR-02)', () => {
    stubApi({});
    renderApp(<CreateCreditCardContainer />, { locale: 'es' });

    expect(screen.getByLabelText(es.creditCards.form.reminderDays)).toBeDefined();
    expect(screen.getByText(es.creditCards.form.reminderDaysHint)).toBeDefined();
  });
});
