import { describe, expect, it } from 'vitest';
import {
  buildInstallmentPurchaseRequest,
  type InstallmentFormValues,
  type InstallmentRequestContext,
} from '../src/features/credit-cards/installment-request';

const NOW = new Date('2026-10-02T15:30:00.000Z');
const COMIDA = '00000000-0000-4000-8000-000000000011';

const context: InstallmentRequestContext = {
  categories: [
    { id: COMIDA, archived: false },
    { id: '00000000-0000-4000-8000-000000000012', archived: true },
  ],
  timeZone: 'America/Argentina/Buenos_Aires',
  locale: 'es',
  now: NOW,
};

function values(overrides: Partial<InstallmentFormValues> = {}): InstallmentFormValues {
  return {
    currency: 'ARS',
    amount: '120.000,00',
    installments: '12',
    categoryId: COMIDA,
    purchasedOn: '2026-10-02',
    note: '',
    ...overrides,
  };
}

describe('buildInstallmentPurchaseRequest', () => {
  it('turns "120.000,00", 12 and a category into an amount of 12000000 and 12 installments (AC-01)', () => {
    expect(buildInstallmentPurchaseRequest(values(), context)).toEqual({
      purchase: {
        kind: 'installments',
        request: {
          currency: 'ARS',
          categoryId: COMIDA,
          amount: '12000000',
          installments: 12,
          purchasedOn: '2026-10-02',
        },
      },
    });
  });

  it('builds a USD installment request in the chosen currency and keeps a trimmed note', () => {
    const result = buildInstallmentPurchaseRequest(
      values({ currency: 'USD', amount: '1.200,00', note: '  heladera  ' }),
      context,
    );
    expect(result.purchase).toMatchObject({
      kind: 'installments',
      request: { currency: 'USD', amount: '120000', note: 'heladera' },
    });
  });

  it('builds a card expense with the automatic rate for one payment, now for today', () => {
    expect(
      buildInstallmentPurchaseRequest(values({ currency: 'USD', installments: '1' }), context),
    ).toEqual({
      purchase: {
        kind: 'single',
        request: {
          currency: 'USD',
          categoryId: COMIDA,
          amount: '12000000',
          occurredAt: NOW.toISOString(),
          rate: { source: 'automatic' },
        },
      },
    });
  });

  it('dates a one-payment purchase of another day at noon in the user zone', () => {
    const result = buildInstallmentPurchaseRequest(
      values({ installments: '1', purchasedOn: '2026-09-30', note: 'cena' }),
      context,
    );
    expect(result.purchase).toMatchObject({
      kind: 'single',
      request: { occurredAt: '2026-09-30T15:00:00.000Z', note: 'cena' },
    });
  });

  it.each(['', 'EUR', 'ars'])('refuses the currency %j with a field message', (currency) => {
    expect(buildInstallmentPurchaseRequest(values({ currency }), context)).toEqual({
      fields: { currency: 'creditCards.expense.errors.currencyRequired' },
    });
  });

  it.each(['61', '0', '', '2,5', 'doce', '-3', '1000'])(
    'refuses %j installments with a field message and no request (AC-02)',
    (installments) => {
      expect(buildInstallmentPurchaseRequest(values({ installments }), context)).toEqual({
        fields: { installments: 'creditCards.installments.errors.installmentsInvalid' },
      });
    },
  );

  it.each(['1', '2', '60'])('accepts %s installments at the limits (AC-02)', (installments) => {
    expect(
      buildInstallmentPurchaseRequest(values({ installments }), context).purchase,
    ).toBeDefined();
  });

  it.each([
    ['empty', '', 'movements.errors.amountInvalid'],
    ['zero', '0', 'movements.errors.amountNotPositive'],
    ['three decimals', '1,234', 'movements.errors.amountInvalid'],
  ])('refuses a %s amount with a field message and no request', (_name, amount, key) => {
    expect(buildInstallmentPurchaseRequest(values({ amount }), context)).toEqual({
      fields: { amount: key },
    });
  });

  it('accepts one cent for a single payment', () => {
    expect(
      buildInstallmentPurchaseRequest(values({ amount: '0,01', installments: '1' }), context)
        .purchase,
    ).toBeDefined();
  });

  it('refuses an amount below one cent per installment', () => {
    expect(
      buildInstallmentPurchaseRequest(values({ amount: '0,05', installments: '12' }), context),
    ).toEqual({ fields: { amount: 'creditCards.installments.errors.amountTooSmall' } });
  });

  it('refuses a missing, unknown or archived category', () => {
    for (const categoryId of ['', 'nope', '00000000-0000-4000-8000-000000000012']) {
      expect(buildInstallmentPurchaseRequest(values({ categoryId }), context)).toEqual({
        fields: { category: 'movements.errors.categoryRequired' },
      });
    }
  });

  it('refuses a future date in the user zone and a date that does not exist', () => {
    expect(
      buildInstallmentPurchaseRequest(values({ purchasedOn: '2026-10-03' }), context).fields,
    ).toEqual({ purchasedOn: 'errors.movementDateInFuture' });
    expect(
      buildInstallmentPurchaseRequest(values({ purchasedOn: '2027-02-29' }), context).fields,
    ).toEqual({ purchasedOn: 'movements.errors.dateInvalid' });
    expect(buildInstallmentPurchaseRequest(values({ purchasedOn: '' }), context).fields).toEqual({
      purchasedOn: 'movements.errors.dateInvalid',
    });
  });

  it('accepts today in the user zone even when it is already tomorrow in UTC', () => {
    const lateNight = { ...context, now: new Date('2026-10-03T01:00:00.000Z') };
    expect(
      buildInstallmentPurchaseRequest(values({ purchasedOn: '2026-10-02' }), lateNight).purchase,
    ).toBeDefined();
  });

  it('refuses a note with a zero-width character or over 500 characters', () => {
    expect(buildInstallmentPurchaseRequest(values({ note: 'a​b' }), context).fields).toEqual({
      note: 'movements.errors.noteInvalidCharacters',
    });
    expect(
      buildInstallmentPurchaseRequest(values({ note: 'a'.repeat(501) }), context).fields,
    ).toEqual({ note: 'movements.errors.noteTooLong' });
  });

  it('reports every invalid field at once and builds no request', () => {
    const result = buildInstallmentPurchaseRequest(
      values({ amount: '', installments: '61', categoryId: '' }),
      context,
    );
    expect(result.purchase).toBeUndefined();
    expect(Object.keys(result.fields ?? {}).sort()).toEqual(['amount', 'category', 'installments']);
  });
});
