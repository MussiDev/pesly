import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildDebitAccountsRequest,
  debitCandidates,
} from '../src/features/credit-cards/debit-accounts-request';

const BANK_ARS = '33333333-3333-4333-8333-333333333333';
const BANK_USD = '44444444-4444-4444-8444-444444444444';
const CARD_ARS = '11111111-1111-4111-8111-111111111111';
const CARD_USD = '22222222-2222-4222-8222-222222222222';

const card = { arsAccountId: CARD_ARS, usdAccountId: CARD_USD };

const accounts = [
  { id: BANK_ARS, currency: 'ARS', type: 'bank_account', archived: false },
  { id: BANK_USD, currency: 'USD', type: 'bank_account', archived: false },
  { id: '55555555-5555-4555-8555-555555555555', currency: 'ARS', type: 'cash', archived: true },
  { id: CARD_ARS, currency: 'ARS', type: 'credit_card', archived: false },
  {
    id: '66666666-6666-4666-8666-666666666666',
    currency: 'ARS',
    type: 'credit_card',
    archived: false,
  },
  { id: '77777777-7777-4777-8777-777777777777', currency: 'ARS', type: 'savings', archived: false },
] as const;

type Messages = { errors: Record<string, string | undefined> };

function errorsOf(locale: 'en' | 'es'): Messages['errors'] {
  const path = fileURLToPath(new URL(`../messages/${locale}.json`, import.meta.url));
  return (JSON.parse(readFileSync(path, 'utf8')) as Messages).errors;
}

describe('debit account error messages (FR-01)', () => {
  it.each(['en', 'es'] as const)(
    'has the two new codes and the reworded link message in %s',
    (locale) => {
      const errors = errorsOf(locale);

      expect(errors['debitAccountCurrencyMismatch']?.length).toBeGreaterThan(0);
      expect(errors['debitAccountIsCardAccount']?.length).toBeGreaterThan(0);
      // D7: the 409 now also answers a debit account, so the old "belongs to" wording is gone.
      expect(errors['accountLinkedToCard']).not.toMatch(/belongs to|pertenece a/);
      expect(errors['accountLinkedToCard']).toMatch(/debit|débito/i);
    },
  );
});

describe('buildDebitAccountsRequest', () => {
  it('turns an ARS selection and an empty USD selection into id and null (AC-01)', () => {
    expect(buildDebitAccountsRequest({ ars: BANK_ARS, usd: '' })).toEqual({
      debitArsAccountId: BANK_ARS,
      debitUsdAccountId: null,
    });
  });

  it('turns two empty selections into two nulls (AC-04)', () => {
    expect(buildDebitAccountsRequest({ ars: '', usd: '' })).toEqual({
      debitArsAccountId: null,
      debitUsdAccountId: null,
    });
  });

  it('drops a value that is not a UUID instead of sending it (invalid input)', () => {
    expect(buildDebitAccountsRequest({ ars: 'not-an-id', usd: BANK_USD })).toEqual({
      debitArsAccountId: null,
      debitUsdAccountId: BANK_USD,
    });
  });
});

describe('debitCandidates', () => {
  it('lists open non-card accounts of the currency only (AC-02)', () => {
    const ids = debitCandidates(accounts, 'ARS', card).map((account) => account.id);

    expect(ids).toEqual([BANK_ARS, '77777777-7777-4777-8777-777777777777']);
  });

  it('never offers a USD account for ARS nor an ARS one for USD (AC-02)', () => {
    expect(debitCandidates(accounts, 'USD', card).map((account) => account.id)).toEqual([BANK_USD]);
  });

  it("never offers the card's own accounts, whatever their type (AC-05)", () => {
    const own = [{ id: CARD_ARS, currency: 'ARS', type: 'bank_account', archived: false }];

    expect(debitCandidates(own, 'ARS', card)).toEqual([]);
  });
});
