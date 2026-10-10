import { describe, expect, it } from 'vitest';
import { macroVisaLines } from './macro-visa-fixture';
import {
  isSantanderVisaStatement,
  parseSantanderVisaLines,
  parseShortDate,
} from './parse-santander-visa';
import { parsePdfStatementLines } from './parse-statement-pdf';
import { itemRows, SANTANDER_ROWS, santanderLines } from './santander-visa-fixture';
import { StatementParseError } from './statement-types';

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof StatementParseError ? error.code : 'other';
  }
  return undefined;
}

describe('parseShortDate', () => {
  it('reads dd/mm/yy as 20yy', () => {
    expect(parseShortDate('24/09/26')).toBe('2026-09-24');
    expect(parseShortDate('31/02/26')).toBeNull();
    expect(parseShortDate('24/09/2026')).toBeNull();
  });
});

describe('parseSantanderVisaLines', () => {
  const statement = parseSantanderVisaLines(santanderLines());

  it('reads the dates of the Período table and the card ending', () => {
    expect(statement.closingDate).toBe('2026-09-24');
    expect(statement.dueDate).toBe('2026-10-05');
    expect(statement.cardEnding).toBe('1234');
  });

  it('takes the Total a pagar of each currency as the total, not the Subtotal', () => {
    expect(statement.totals).toEqual({ ARS: '900500', USD: '2000' });
  });

  it('reads purchases with installments, vouchers and the currency of the symbol', () => {
    const purchases = statement.lines.filter((line) => line.kind === 'purchase');
    expect(purchases.map((line) => [line.description, line.amount, line.currency])).toEqual([
      ['Tienda uno', '733997', 'ARS'],
      ['Servicio en dolares', '2000', 'USD'],
      ['Seguro de vivi0000534455783-021-004', '164208', 'ARS'],
      ['Suscripcion uno', '1390', 'ARS'],
      ['Suscripcion dos', '600', 'ARS'],
    ]);
    expect(purchases[0]).toMatchObject({
      date: '2026-04-30',
      voucher: '000111',
      installmentNumber: 5,
      installmentCount: 6,
    });
    expect(purchases[1]).toMatchObject({ voucher: '000222', installmentNumber: null });
  });

  it('inherits the date of the previous row when the row has none', () => {
    const second = statement.lines.find((line) => line.description === 'Suscripcion dos');
    expect(second?.date).toBe('2026-09-07');
  });

  it('joins a wrapped description to the row above it', () => {
    expect(statement.lines.map((line) => line.description)).toContain(
      'Seguro de vivi0000534455783-021-004',
    );
  });

  it('reads fees without the $ glyph, dated like the first fee row', () => {
    const fees = statement.lines.filter((line) => line.kind === 'fee');
    expect(fees.map((line) => [line.date, line.description, line.amount])).toEqual([
      ['2026-09-24', 'Impuesto de sellos', '5'],
      ['2026-09-24', 'Iibb percep-sant 3,00%( 100,00)', '300'],
    ]);
  });

  it('reads payments with the minus before the symbol, one per currency, and skips balances', () => {
    const payments = statement.lines.filter((line) => line.kind === 'payment');
    expect(payments.map((line) => [line.currency, line.amount])).toEqual([
      ['ARS', '-10000'],
      ['USD', '-500'],
    ]);
    expect(statement.lines.some((line) => /^saldo/i.test(line.description))).toBe(false);
  });

  it('adds up to the total: purchases plus fees', () => {
    const sum = (currency: string) =>
      statement.lines
        .filter((line) => line.kind !== 'payment' && line.currency === currency)
        .reduce((total, line) => total + BigInt(line.amount), 0n);
    expect(sum('ARS')).toBe(900500n);
    expect(sum('USD')).toBe(2000n);
  });

  it('keeps words that reach into the cuota column as part of the description', () => {
    const rows = SANTANDER_ROWS.map((row) =>
      row[1]?.[0] === 'Tienda uno'
        ? ([
            ['30/04/26', 45, 87],
            ['Tienda con un nombre larguisimo que invade', 104, 300],
            ['000111', 300, 334],
            ['$ 7.339,97', 410, 458],
          ] as const)
        : row,
    );
    const lines = parseSantanderVisaLines(santanderLines(rows)).lines;
    expect(lines[2]).toMatchObject({
      description: 'Tienda con un nombre larguisimo que invade',
      installmentNumber: null,
    });
  });

  it('fails clearly without the Período table or any line', () => {
    const noPeriod = SANTANDER_ROWS.filter((row) => row[0]?.[0] !== '20/08/26');
    expect(codeOf(() => parseSantanderVisaLines(santanderLines(noPeriod)))).toBe('unrecognized');
    const noLines = SANTANDER_ROWS.slice(0, 11);
    const lines = itemRows([
      ...noLines,
      [
        ['Total a pagar', 54, 116],
        ['$ 0,00', 391, 460],
      ],
    ]);
    expect(codeOf(() => parseSantanderVisaLines(lines))).toBe('noLines');
  });
});

describe('format detection', () => {
  it('tells the Santander layout from the Macro one and picks Santander first', () => {
    expect(isSantanderVisaStatement(santanderLines())).toBe(true);
    expect(isSantanderVisaStatement(macroVisaLines())).toBe(false);
    expect(parsePdfStatementLines(santanderLines()).cardEnding).toBe('1234');
    expect(parsePdfStatementLines(macroVisaLines()).cardEnding).toBe('0045');
  });

  it('refuses a layout without the markers', () => {
    expect(codeOf(() => parseSantanderVisaLines(macroVisaLines()))).toBe('unrecognizedFormat');
  });
});
