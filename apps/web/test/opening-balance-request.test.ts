import { describe, expect, it } from 'vitest';
import { buildOpeningBalanceRequest } from '../src/features/accounts/opening-balance-request';

describe('buildOpeningBalanceRequest', () => {
  it.each([
    ['es', '1.234,56', '123456'],
    ['en', '1,234.56', '123456'],
    ['es', '-10', '-1000'],
    ['en', '0', '0'],
    ['es', '  5,5 ', '550'],
    ['en', '10000000000000.00', '1000000000000000'],
    ['en', '-10000000000000.00', '-1000000000000000'],
  ])('turns %s text %j into the minor-unit string %s (AC-16, NFR-02)', (locale, text, minor) => {
    expect(buildOpeningBalanceRequest(text, locale)).toEqual({
      request: { openingBalance: minor },
    });
  });

  it.each(['', '   ', 'abc', '1,2,3', '12.345,678', '--5'])(
    'rejects %j with the invalid-amount key and no request (AC-17)',
    (text) => {
      expect(buildOpeningBalanceRequest(text, 'es')).toEqual({
        error: 'accounts.errors.amountInvalid',
      });
    },
  );

  it.each([
    ['es', '10.000.000.000.000,01'],
    ['en', '-10,000,000,000,000.01'],
  ])('rejects %s text %j above the limit with the out-of-range key (AC-18)', (locale, text) => {
    expect(buildOpeningBalanceRequest(text, locale)).toEqual({
      error: 'accounts.errors.amountOutOfRange',
    });
  });
});
