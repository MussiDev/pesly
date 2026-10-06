import { describe, expect, it } from 'vitest';
import { parseInitialType } from '../src/features/movements/initial-type';

describe('parseInitialType (AC-14)', () => {
  it.each(['expense', 'income', 'transfer', 'exchange'] as const)(
    'returns %s for its exact value',
    (type) => {
      expect(parseInitialType(type)).toBe(type);
    },
  );

  it.each([undefined, '', 'nope', 'INCOME', 'Income', ' income', 'income ', 'expense,income'])(
    'error: an absent, empty, unknown or differently written value (%j) starts on expense',
    (value) => {
      expect(parseInitialType(value)).toBe('expense');
    },
  );

  it('error: a repeated parameter starts on expense, whatever its values are', () => {
    expect(parseInitialType(['income', 'expense'])).toBe('expense');
    expect(parseInitialType(['income'])).toBe('expense');
    expect(parseInitialType([])).toBe('expense');
  });

  it('error: a value built to look like a prototype key or markup is not a type', () => {
    expect(parseInitialType('__proto__')).toBe('expense');
    expect(parseInitialType('constructor')).toBe('expense');
    expect(parseInitialType('<script>alert(1)</script>')).toBe('expense');
  });
});
