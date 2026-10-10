import { describe, expect, it } from 'vitest';
import {
  columnsRow,
  macroVisaLines,
  MACRO_DETAIL_ROWS,
  monospacedLines,
} from './macro-visa-fixture';
import {
  isMacroVisaStatement,
  parseMacroAmount,
  parseMacroVisaLines,
  parseNumericDate,
  parseSpanishTextDate,
} from './parse-macro-visa';
import { parsePdfStatementLines } from './parse-statement-pdf';
import { groupItemsIntoLines, splitRunIntoWords } from './pdf-lines';
import { StatementParseError } from './statement-types';

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof StatementParseError ? error.code : 'other';
  }
  return undefined;
}

describe('groupItemsIntoLines', () => {
  const item = (text: string, x: number, y: number) => ({ text, x, xEnd: x + text.length, y });

  it('groups by baseline within the tolerance, top first, and sorts by x', () => {
    const lines = groupItemsIntoLines([
      item('B', 50, 700.8),
      item('low', 10, 600),
      item('A', 10, 701),
      item('C', 90, 699),
    ]);
    expect(lines.map((line) => line.map((word) => word.text))).toEqual([['A', 'B', 'C'], ['low']]);
  });

  it('keeps lines apart when the baselines differ by more than the tolerance', () => {
    const lines = groupItemsIntoLines([item('a', 0, 100), item('b', 0, 95)], 2);
    expect(lines).toHaveLength(2);
  });

  it('drops blank items and handles no items', () => {
    expect(groupItemsIntoLines([item('  ', 0, 1), item('', 0, 1)])).toEqual([]);
    expect(groupItemsIntoLines([])).toEqual([]);
  });
});

describe('splitRunIntoWords', () => {
  it('interpolates the x of each word over the run width', () => {
    const words = splitRunIntoWords({ text: 'AB   CD', x: 100, xEnd: 170, y: 5 });
    expect(words.map((word) => [word.text, word.x, word.xEnd])).toEqual([
      ['AB', 100, 120],
      ['CD', 150, 170],
    ]);
  });

  it('gives nothing for an empty run', () => {
    expect(splitRunIntoWords({ text: '', x: 0, xEnd: 0, y: 0 })).toEqual([]);
  });
});

describe('Macro value parsers', () => {
  it('reads Spanish text dates with two-digit years', () => {
    expect(parseSpanishTextDate('24 Sep 26')).toBe('2026-09-24');
    expect(parseSpanishTextDate('VTO. ANTERIOR 01 Sep 26')).toBe('2026-09-01');
    expect(parseSpanishTextDate('02 oct 26')).toBe('2026-10-02');
    expect(parseSpanishTextDate('31 Feb 26')).toBeNull();
    expect(parseSpanishTextDate('24 Xyz 26')).toBeNull();
  });

  it('reads dd.mm.yy dates', () => {
    expect(parseNumericDate('11.05.26')).toBe('2026-05-11');
    expect(parseNumericDate('31.02.26')).toBeNull();
    expect(parseNumericDate('11/05/26')).toBeNull();
  });

  it('reads amounts into minor units without floats', () => {
    expect(parseMacroAmount('29.883,27')).toBe('2988327');
    expect(parseMacroAmount('29,88')).toBe('2988');
    expect(parseMacroAmount('0,00')).toBe('0');
    expect(parseMacroAmount('-,--')).toBe('0');
    expect(parseMacroAmount('29.913,15-')).toBe('-2991315');
    expect(parseMacroAmount('9007199254740993,01')).toBe('900719925474099301');
    expect(parseMacroAmount('29.88')).toBeNull();
    expect(parseMacroAmount('BIDCOM')).toBeNull();
  });
});

describe('parseMacroVisaLines', () => {
  it('reads the header, the lines and the SALDO ACTUAL total', () => {
    const statement = parseMacroVisaLines(macroVisaLines());
    expect(statement).toEqual({
      closingDate: '2026-09-24',
      dueDate: '2026-10-02',
      cardEnding: '0045',
      totals: { ARS: '2991315', USD: null },
      lines: [
        {
          date: '2026-09-01',
          description: 'SU PAGO EN PESOS',
          voucher: null,
          installmentNumber: null,
          installmentCount: null,
          currency: 'ARS',
          amount: '-2991315',
          kind: 'payment',
        },
        {
          date: '2026-05-11',
          description: 'BIDCOM',
          voucher: '001973*',
          installmentNumber: 5,
          installmentCount: 18,
          currency: 'ARS',
          amount: '2988327',
          kind: 'purchase',
        },
        {
          date: '2026-09-24',
          description: 'IMPUESTO DE SELLOS',
          voucher: null,
          installmentNumber: null,
          installmentCount: null,
          currency: 'ARS',
          amount: '2988',
          kind: 'fee',
        },
      ],
    });
  });

  it('adds up to the total: purchases plus fees, payment left out', () => {
    const statement = parseMacroVisaLines(macroVisaLines());
    const sum = statement.lines
      .filter((line) => line.kind !== 'payment')
      .reduce((total, line) => total + BigInt(line.amount), 0n);
    expect(sum).toBe(BigInt(statement.totals.ARS ?? '0'));
  });

  it('puts an amount in USD when its right edge is under DOLARES, not by order', () => {
    const detail = [
      ...MACRO_DETAIL_ROWS.slice(0, 5),
      columnsRow('15.09.26 004455 NETFLIX COM', '', '15,99'),
      ...MACRO_DETAIL_ROWS.slice(5, 6),
      columnsRow('SALDO ACTUAL $', '29.913,15', '15,99'),
    ];
    const statement = parseMacroVisaLines(macroVisaLines(detail));
    const usd = statement.lines.find((line) => line.description === 'NETFLIX COM');
    expect(usd).toMatchObject({
      currency: 'USD',
      amount: '1599',
      voucher: '004455',
      kind: 'purchase',
    });
    expect(statement.totals).toEqual({ ARS: '2991315', USD: '1599' });
  });

  it('keeps a plain purchase for a 01/01 installment and for a name that is not a fee', () => {
    const detail = [
      MACRO_DETAIL_ROWS[0] ?? '',
      columnsRow('02.09.26 778899 KIOSCO Cuota 01/01', '1.000,00'),
      columnsRow('03.09.26 AJUSTE VARIO', '2,50'),
      columnsRow('SALDO ACTUAL $', '1.002,50'),
    ];
    const lines = parseMacroVisaLines(macroVisaLines(detail)).lines;
    expect(lines[0]).toMatchObject({
      description: 'KIOSCO',
      installmentNumber: null,
      installmentCount: null,
    });
    expect(lines[1]).toMatchObject({ kind: 'purchase', voucher: null });
  });

  it('classifies fee names', () => {
    const detail = [
      MACRO_DETAIL_ROWS[0] ?? '',
      columnsRow('24.09.26 IVA RI 21%', '10,00'),
      columnsRow('24.09.26 COMISION MANTENIMIENTO', '20,00'),
      columnsRow('24.09.26 INTERESES FINANCIACION', '30,00'),
      columnsRow('24.09.26 SEGURO DE VIDA', '40,00'),
      columnsRow('24.09.26 PERCEP IIBB', '50,00'),
      columnsRow('SALDO ACTUAL $', '150,00'),
    ];
    const kinds = parseMacroVisaLines(macroVisaLines(detail)).lines.map((line) => line.kind);
    expect(kinds).toEqual(['fee', 'fee', 'fee', 'fee', 'fee']);
  });

  it('skips rows whose amounts are all zero', () => {
    const detail = [
      ...MACRO_DETAIL_ROWS.slice(0, 4),
      columnsRow('12.09.26 000111 NADA', '0,00', '-,--'),
      ...MACRO_DETAIL_ROWS.slice(4),
    ];
    const statement = parseMacroVisaLines(macroVisaLines(detail));
    expect(statement.lines.map((line) => line.description)).not.toContain('NADA');
  });

  it('rejects a row with amounts in both columns', () => {
    const detail = [
      MACRO_DETAIL_ROWS[0] ?? '',
      columnsRow('12.09.26 000111 DOBLE', '1,00', '2,00'),
    ];
    expect(codeOf(() => parseMacroVisaLines(macroVisaLines(detail)))).toBe('invalidRow');
  });

  it('leaves the totals empty when SALDO ACTUAL is missing', () => {
    const detail = MACRO_DETAIL_ROWS.filter((row) => !row.startsWith('SALDO ACTUAL'));
    const statement = parseMacroVisaLines(macroVisaLines(detail));
    expect(statement.totals).toEqual({ ARS: null, USD: null });
    expect(statement.lines).toHaveLength(3);
  });

  it('fails clearly without the due date, the amount columns or any line', () => {
    const noDue = monospacedLines(['CIERRE ACTUAL: 24 Sep 26', ...MACRO_DETAIL_ROWS]);
    expect(codeOf(() => parseMacroVisaLines(noDue))).toBe('unrecognized');
    const noColumns = monospacedLines([
      'CIERRE ACTUAL: 24 Sep 26',
      'VENCIMIENTO SALDO',
      '02 Oct 26',
      'FECHA COMPROBANTE DETALLE DE TRANSACCION',
    ]);
    expect(codeOf(() => parseMacroVisaLines(noColumns))).toBe('unrecognized');
    const empty = macroVisaLines([MACRO_DETAIL_ROWS[0] ?? '', MACRO_DETAIL_ROWS[2] ?? '']);
    expect(codeOf(() => parseMacroVisaLines(empty))).toBe('noLines');
  });
});

describe('parsePdfStatementLines', () => {
  it('recognizes the layout by its markers', () => {
    expect(isMacroVisaStatement(macroVisaLines())).toBe(true);
    expect(parsePdfStatementLines(macroVisaLines()).dueDate).toBe('2026-10-02');
  });

  it('refuses an unrecognized layout', () => {
    const other = monospacedLines(['RESUMEN DE OTRO BANCO', 'TOTAL 1.000,00']);
    expect(isMacroVisaStatement(other)).toBe(false);
    expect(codeOf(() => parsePdfStatementLines(other))).toBe('unrecognizedFormat');
    expect(codeOf(() => parseMacroVisaLines(other))).toBe('unrecognizedFormat');
  });

  it('reports a PDF without text as having no text layer', () => {
    expect(codeOf(() => parsePdfStatementLines([]))).toBe('noTextLayer');
  });
});
