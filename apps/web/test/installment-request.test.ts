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
      request: {
        currency: 'ARS',
        categoryId: COMIDA,
        amount: '12000000',
        installments: 12,
        purchasedOn: '2026-10-02',
      },
    });
  });

  it('always builds an ARS request and keeps a trimmed note (AC-03)', () => {
    const result = buildInstallmentPurchaseRequest(values({ note: '  heladera  ' }), context);
    expect(result.request).toMatchObject({ currency: 'ARS', note: 'heladera' });
  });

  it.each(['1', '61', '0', '', '2,5', 'doce', '-3', '1000'])(
    'refuses %j installments with a field message and no request (AC-02)',
    (installments) => {
      expect(buildInstallmentPurchaseRequest(values({ installments }), context)).toEqual({
        fields: { installments: 'creditCards.installments.errors.installmentsInvalid' },
      });
    },
  );

  it.each(['2', '60'])('accepts %s installments at the limits (AC-02)', (installments) => {
    expect(
      buildInstallmentPurchaseRequest(values({ installments }), context).request,
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
      buildInstallmentPurchaseRequest(values({ purchasedOn: '2026-10-02' }), lateNight).request,
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
      values({ amount: '', installments: '1', categoryId: '' }),
      context,
    );
    expect(result.request).toBeUndefined();
    expect(Object.keys(result.fields ?? {}).sort()).toEqual(['amount', 'category', 'installments']);
  });
});
