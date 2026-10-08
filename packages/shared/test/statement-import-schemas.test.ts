import { describe, expect, it } from 'vitest';
import {
  STATEMENT_IMPORT_MAX_LINES,
  createStatementImportRequestSchema,
  statementImportLineSchema,
} from '../src/credit-cards/statement-import';

const UUID = '3f0c1a52-6a43-4e0e-9a33-6f1f2b5d7a10';
const LINE = {
  date: '2026-08-10',
  description: '  Sample shop  ',
  voucher: '000123*',
  currency: 'ARS',
  amount: '1234567',
  installmentNumber: 2,
  installmentCount: 6,
  kind: 'purchase',
};
const REQUEST = { closingDate: '2026-09-24', categoryId: UUID, lines: [LINE] };

describe('createStatementImportRequestSchema', () => {
  it('accepts a request and trims the description', () => {
    const parsed = createStatementImportRequestSchema.parse(REQUEST);
    expect(parsed.lines[0]?.description).toBe('Sample shop');
  });

  it('accepts a plain USD purchase without voucher or installments', () => {
    const line = {
      ...LINE,
      currency: 'USD',
      voucher: null,
      installmentNumber: null,
      installmentCount: null,
    };
    expect(statementImportLineSchema.safeParse(line).success).toBe(true);
  });

  it.each([
    ['no lines', { ...REQUEST, lines: [] }],
    ['too many lines', { ...REQUEST, lines: Array(STATEMENT_IMPORT_MAX_LINES + 1).fill(LINE) }],
    ['a non-uuid category', { ...REQUEST, categoryId: 'x' }],
    ['an unknown key', { ...REQUEST, extra: 1 }],
    ['a bad closing date', { ...REQUEST, closingDate: '24/09/2026' }],
  ])('rejects %s', (_name, body) => {
    expect(createStatementImportRequestSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    ['a float amount', { amount: '12.5' }],
    ['a negative amount', { amount: '-5' }],
    ['a zero amount', { amount: '0' }],
    ['an empty description', { description: '   ' }],
    ['an unknown currency', { currency: 'EUR' }],
    ['a number without count', { installmentCount: null }],
    ['a number above the count', { installmentNumber: 7 }],
    ['an installment fee', { kind: 'fee' }],
    ['the payment kind', { kind: 'payment' }],
  ])('rejects a line with %s', (_name, patch) => {
    expect(statementImportLineSchema.safeParse({ ...LINE, ...patch }).success).toBe(false);
  });

  it('accepts exactly the maximum number of lines', () => {
    const lines = Array(STATEMENT_IMPORT_MAX_LINES).fill(LINE);
    expect(createStatementImportRequestSchema.safeParse({ ...REQUEST, lines }).success).toBe(true);
  });
});
