import { describe, expect, it } from 'vitest';
import {
  balanceDifference,
  buildSetBalanceRequest,
} from '../src/features/accounts/set-balance-request';

describe('balanceDifference', () => {
  it.each([
    [150000n, 200000n, 50000n],
    [150000n, 100000n, -50000n],
    [-500n, 500n, 1000n],
    [500n, 500n, 0n],
    // Beyond int64: the preview never overflows because it is plain bigint arithmetic.
    [9_223_372_036_854_775_807n, -1_000_000_000_000_000n, -9_224_372_036_854_775_807n],
  ])('is target minus current: %s -> %s is %s (AC-10, NFR-03)', (current, target, difference) => {
    expect(balanceDifference(current, target)).toBe(difference);
  });
});

describe('buildSetBalanceRequest', () => {
  it.each([
    ['es', '1.234,56', '123456'],
    ['en', '1,234.56', '123456'],
    ['es', '-10', '-1000'],
    ['en', '0', '0'],
    ['en', '10000000000000.00', '1000000000000000'],
    ['en', '-10000000000000.00', '-1000000000000000'],
  ])('turns %s text %j into the minor-unit string %s (AC-12, NFR-03)', (locale, text, balance) => {
    expect(buildSetBalanceRequest({ text, locale })).toEqual({ request: { balance } });
  });

  it.each(['', '   ', 'abc', '1,2,3', '--5'])(
    'rejects %j with the invalid-amount message and no request (AC-12)',
    (text) => {
      expect(buildSetBalanceRequest({ text, locale: 'es' })).toEqual({
        error: { field: 'balance', message: 'accounts.errors.amountInvalid' },
      });
    },
  );

  it.each([
    ['es', '10.000.000.000.000,01'],
    ['en', '-10,000,000,000,000.01'],
  ])('rejects %s text %j above the limit with the out-of-range message (AC-12)', (locale, text) => {
    expect(buildSetBalanceRequest({ text, locale })).toEqual({
      error: { field: 'balance', message: 'accounts.errors.amountOutOfRange' },
    });
  });

  it('sends the trimmed note and leaves it out when blank', () => {
    expect(buildSetBalanceRequest({ text: '5', locale: 'en', note: '  Cash count  ' })).toEqual({
      request: { balance: '500', note: 'Cash count' },
    });
    expect(buildSetBalanceRequest({ text: '5', locale: 'en', note: '   ' })).toEqual({
      request: { balance: '500' },
    });
  });

  it('refuses a note with a control or format character (error path)', () => {
    expect(buildSetBalanceRequest({ text: '5', locale: 'en', note: 'a​b' })).toEqual({
      error: { field: 'note', message: 'accounts.setBalance.errors.noteInvalid' },
    });
  });

  it('sends the second-factor code only when one is given (AC-19)', () => {
    expect(buildSetBalanceRequest({ text: '5', locale: 'en', code: ' 123456 ' })).toEqual({
      request: { balance: '500', secondFactorCode: '123456' },
    });
    expect(buildSetBalanceRequest({ text: '5', locale: 'en', code: undefined })).toEqual({
      request: { balance: '500' },
    });
  });

  it.each(['', '12', 'not a code!'])(
    'refuses the malformed second-factor code %j before any request (AC-20)',
    (code) => {
      expect(buildSetBalanceRequest({ text: '5', locale: 'en', code })).toEqual({
        error: { field: 'code', message: 'errors.secondFactorCodeFormat' },
      });
    },
  );
});
