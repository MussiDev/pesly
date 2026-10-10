import writeExcelFile from 'write-excel-file/universal';
import { describe, expect, it } from 'vitest';
import {
  parseStatementAmount,
  parseStatementDate,
  parseStatementRows,
  type StatementCell,
} from './parse-statement-rows';
import { STATEMENT_FILE_MAX_BYTES, parseStatementXlsx } from './parse-statement-xlsx';
import { syntheticStatementRows } from './statement-fixture';
import { StatementParseError } from './statement-types';

describe('parseStatementAmount', () => {
  it.each([
    ['$7.339,97', 'ARS', '733997'],
    ['$1.234.567,89', 'ARS', '123456789'],
    ['U$S20,00', 'USD', '2000'],
    ['U$S1,5', 'USD', '150'],
    ['$-954.428,29', 'ARS', '-95442829'],
    ['-$10,00', 'ARS', '-1000'],
    ['$500', 'ARS', '50000'],
    ['$0,00', 'ARS', '0'],
  ])('reads %s exactly', (input, currency, minor) => {
    expect(parseStatementAmount(input)).toEqual({ currency, minor });
  });

  it('reads a numeric cell without a currency', () => {
    expect(parseStatementAmount(1234.5)).toEqual({ currency: null, minor: '123450' });
  });

  it.each(['abc', '$1.2.3,4', '$1,234', '$12,345,67', '1e5', '$ ', 'U$S--5,00'])(
    'rejects %s',
    (input) => {
      expect(() => parseStatementAmount(input)).toThrow(StatementParseError);
    },
  );

  it('keeps digits beyond the float range exact', () => {
    expect(parseStatementAmount('$90.071.992.547.409,93').minor).toBe('9007199254740993');
  });
});

describe('parseStatementDate', () => {
  it('converts dd/mm/yyyy and rejects impossible days', () => {
    expect(parseStatementDate('05/10/2026')).toBe('2026-10-05');
    expect(parseStatementDate('31/02/2026')).toBeNull();
    expect(parseStatementDate('2026-10-05')).toBeNull();
  });
});

describe('parseStatementRows', () => {
  const parsed = parseStatementRows(syntheticStatementRows());

  it('finds the dates, the card ending and the totals by their labels', () => {
    expect(parsed.closingDate).toBe('2026-09-24');
    expect(parsed.dueDate).toBe('2026-10-05');
    expect(parsed.cardEnding).toBe('1234');
    expect(parsed.totals).toEqual({ ARS: '123697376', USD: '2050' });
  });

  it('classifies payments, purchases and fees', () => {
    const count = (kind: string) => parsed.lines.filter((line) => line.kind === kind).length;
    expect(count('payment')).toBe(1);
    expect(count('purchase')).toBe(7);
    expect(count('fee')).toBe(2);
  });

  it('keeps the negative payment out of the purchases', () => {
    const payment = parsed.lines.find((line) => line.kind === 'payment');
    expect(payment).toMatchObject({ amount: '-500000', currency: 'ARS', installmentCount: null });
  });

  it('reads "N de M" as installment N of M', () => {
    expect(parsed.lines.find((line) => line.description === 'Tienda uno')).toMatchObject({
      date: '2026-04-30',
      installmentNumber: 5,
      installmentCount: 6,
      amount: '123456',
      voucher: '000111*',
    });
  });

  it('reads thousands separators and USD rows', () => {
    expect(parsed.lines.find((line) => line.description === 'Tienda dos')?.amount).toBe(
      '123456789',
    );
    expect(parsed.lines.find((line) => line.date === '2026-08-22')).toMatchObject({
      currency: 'USD',
      amount: '2000',
      installmentNumber: null,
    });
  });

  it('lets an empty date inherit the previous row and maps "-" and empty vouchers to null', () => {
    const inherited = parsed.lines.find((line) => line.description === 'Compra misma fecha');
    expect(inherited).toMatchObject({ date: '2026-09-01', voucher: null, amount: '5005' });
    expect(parsed.lines.find((line) => line.description === 'Compra uno')?.voucher).toBeNull();
  });

  it('dates the fees at the closing date, in pesos, without installments', () => {
    const fees = parsed.lines.filter((line) => line.kind === 'fee');
    expect(fees.map((fee) => [fee.date, fee.currency, fee.amount])).toEqual([
      ['2026-09-24', 'ARS', '1126'],
      ['2026-09-24', 'ARS', '100000'],
    ]);
  });

  it('sums the selected lines to the file totals of the synthetic statement', () => {
    const sum = (currency: string) =>
      parsed.lines
        .filter((line) => line.kind !== 'payment' && line.currency === currency)
        .reduce((total, line) => total + BigInt(line.amount), 0n);
    expect(sum('USD')).toBe(BigInt(parsed.totals.USD ?? '0'));
    expect(sum('ARS')).toBe(BigInt(parsed.totals.ARS ?? '0'));
  });

  it('keeps identical repeated purchases as separate lines', () => {
    const rows = syntheticStatementRows();
    const index = rows.findIndex((row) => row[1] === 'Compra uno');
    rows.splice(index, 0, [...(rows[index] as StatementCell[])]);
    const twice = parseStatementRows(rows).lines.filter(
      (line) => line.description === 'Compra uno',
    );
    expect(twice).toHaveLength(2);
  });

  it('treats "1 de 1" as a plain purchase', () => {
    const rows = syntheticStatementRows();
    const row = rows.find((candidate) => candidate[1] === 'Compra uno') as StatementCell[];
    row[2] = '1 de 1';
    const line = parseStatementRows(rows).lines.find((item) => item.description === 'Compra uno');
    expect(line).toMatchObject({ installmentNumber: null, installmentCount: null });
  });

  it('is tolerant to extra blank rows and a different order of the sections', () => {
    const rows = syntheticStatementRows();
    const shifted = [[], [], [], ...rows];
    expect(parseStatementRows(shifted).lines).toHaveLength(parsed.lines.length);
  });

  it.each([
    ['a malformed amount', 'Tienda uno', 4, '$12,3,4'],
    ['a malformed installment text', 'Tienda uno', 2, 'cinco de seis'],
    ['an installment number above the count', 'Tienda uno', 2, '7 de 6'],
    ['an impossible date', 'Tienda uno', 0, '31/02/2026'],
  ])('rejects %s', (_name, description, column, value) => {
    const rows = syntheticStatementRows();
    const row = rows.find((candidate) => candidate[1] === description) as StatementCell[];
    row[column] = value;
    expect(() => parseStatementRows(rows)).toThrow(StatementParseError);
  });

  it('rejects a row with both amounts', () => {
    const rows = syntheticStatementRows();
    const row = rows.find((candidate) => candidate[1] === 'Compra uno') as StatementCell[];
    row[5] = 'U$S1,00';
    expect(() => parseStatementRows(rows)).toThrow(StatementParseError);
  });

  it('rejects a sheet that is not a statement', () => {
    expect(() =>
      parseStatementRows([
        ['Name', 'Age'],
        ['Ana', 30],
      ]),
    ).toThrow(StatementParseError);
  });

  it('rejects a statement without any importable line', () => {
    const rows = syntheticStatementRows();
    const onlyPayments = rows.slice(
      0,
      rows.findIndex((row) => row[0] === 'Tarjeta de Persona Ejemplo - 9999'),
    );
    expect(() => parseStatementRows(onlyPayments)).toThrow(
      expect.objectContaining({ code: 'noLines' }),
    );
  });
});

describe('parseStatementXlsx', () => {
  async function fileOf(rows: StatementCell[][]): Promise<File> {
    const sheetData = rows.map((row) =>
      row.map((value) => (value === null || value === undefined ? null : { value: String(value) })),
    );
    const blob = await writeExcelFile(sheetData as never).toBlob();
    return new File([blob], 'statement.xlsx');
  }

  it('reads a generated .xlsx file end to end', async () => {
    const parsed = await parseStatementXlsx(await fileOf(syntheticStatementRows()));
    expect(parsed.closingDate).toBe('2026-09-24');
    expect(parsed.lines.filter((line) => line.kind === 'purchase')).toHaveLength(7);
    expect(parsed.totals.ARS).toBe('123697376');
  });

  it('rejects a file that is not a spreadsheet', async () => {
    const file = new File(['not a zip'], 'statement.xlsx');
    await expect(parseStatementXlsx(file)).rejects.toMatchObject({ code: 'unreadable' });
  });

  it('rejects a file above the size cap before reading it', async () => {
    const file = new File([new Uint8Array(STATEMENT_FILE_MAX_BYTES + 1)], 'big.xlsx');
    await expect(parseStatementXlsx(file)).rejects.toMatchObject({ code: 'tooLarge' });
  });
});
