import { describe, expect, it } from 'vitest';
import { safeReturnPath, signInHref } from '../src/features/auth/return-path';

describe('safeReturnPath (D2, AC-03)', () => {
  it.each(['/reports', '/reports/categories', '/reports/income-expenses', '/reports/net-worth'])(
    'accepts %s',
    (path) => {
      expect(safeReturnPath(path)).toBe(path);
    },
  );

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil',
    '/reports/../movements',
    '/reports/net-worth?x=1',
    '/reports/net-worth#top',
    '/reports/net-worth/',
    '%2Freports%2Fnet-worth',
    '/movements',
    '',
  ])('error: %j gives undefined', (value) => {
    expect(safeReturnPath(value)).toBeUndefined();
  });

  it('error: null and undefined give undefined', () => {
    expect(safeReturnPath(null)).toBeUndefined();
    expect(safeReturnPath(undefined)).toBeUndefined();
  });
});

describe('signInHref', () => {
  it('carries a report path encoded', () => {
    expect(signInHref('/reports/net-worth')).toBe('/sign-in?next=%2Freports%2Fnet-worth');
  });

  it('carries nothing for any other path', () => {
    expect(signInHref('/movements')).toBe('/sign-in');
    expect(signInHref('/reports/net-worth?x=1')).toBe('/sign-in');
  });
});
