import { describe, expect, it } from 'vitest';
import {
  firstPeriodOfInstallment,
  fingerprintLine,
  fingerprintLines,
  noteFromDescription,
  type ImportedLineIdentity,
} from '../../src/credit-cards/domain/statement-import';

const LINE: ImportedLineIdentity = {
  date: '2026-08-10',
  description: 'Tienda Uno',
  voucher: '000111*',
  currency: 'ARS',
  amount: 123456n,
  installmentNumber: 2,
  installmentCount: 6,
};

describe('fingerprintLine', () => {
  it('is a 64 character hex digest that does not contain the line data', () => {
    const digest = fingerprintLine(LINE, 0);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain('123456');
  });

  it('ignores case, spacing and unicode form of the description and the voucher', () => {
    const noisy = { ...LINE, description: '  tienda   UNO ', voucher: ' 000111* ' };
    expect(fingerprintLine(noisy, 0)).toBe(fingerprintLine(LINE, 0));
    const decomposed = { ...LINE, description: 'Café' };
    const composed = { ...LINE, description: 'Café' };
    expect(fingerprintLine(decomposed, 0)).toBe(fingerprintLine(composed, 0));
  });

  it.each([
    ['date', { date: '2026-08-11' }],
    ['description', { description: 'Tienda Dos' }],
    ['voucher', { voucher: null }],
    ['currency', { currency: 'USD' as const }],
    ['amount', { amount: 123457n }],
    ['installment number', { installmentNumber: 3 }],
    ['installment count', { installmentCount: 12 }],
  ])('changes with the %s', (_name, patch) => {
    expect(fingerprintLine({ ...LINE, ...patch }, 0)).not.toBe(fingerprintLine(LINE, 0));
  });

  it('changes with the occurrence index', () => {
    expect(fingerprintLine(LINE, 1)).not.toBe(fingerprintLine(LINE, 0));
  });
});

describe('fingerprintLines', () => {
  it('keeps identical lines of one file apart and stable between runs', () => {
    const other = { ...LINE, description: 'Otra' };
    const first = fingerprintLines([LINE, other, LINE, LINE]);
    expect(new Set(first).size).toBe(4);
    expect(fingerprintLines([LINE, other, LINE, LINE])).toEqual(first);
  });

  it('gives the first occurrence the same fingerprint as a file where it is alone', () => {
    expect(fingerprintLines([LINE, LINE])[0]).toBe(fingerprintLines([LINE])[0]);
  });
});

describe('noteFromDescription', () => {
  it('trims, collapses whitespace and strips control and format characters', () => {
    expect(noteFromDescription('  Shop​ \t name\u0000 ')).toBe('Shop name');
  });

  it('cuts to 500 code points without splitting a surrogate pair', () => {
    const note = noteFromDescription('😀'.repeat(600));
    expect(Array.from(note ?? '')).toHaveLength(500);
  });

  it('is undefined for a description that is empty after cleaning', () => {
    expect(noteFromDescription(' ​ ')).toBeUndefined();
  });
});

describe('firstPeriodOfInstallment', () => {
  it('puts installment N on the given period by shifting back N-1 months', () => {
    expect(firstPeriodOfInstallment('2026-09', 1)).toBe('2026-09');
    expect(firstPeriodOfInstallment('2026-09', 5)).toBe('2026-05');
    expect(firstPeriodOfInstallment('2026-02', 4)).toBe('2025-11');
  });
});
