import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import writeExcelFile from 'write-excel-file/universal';
import { describe, expect, it } from 'vitest';
import {
  BALANZ_FILE_MAX_BYTES,
  parseBalanzXlsx,
} from '@/features/investments/balanz-import/parse-balanz-xlsx';

const SAMPLE = fileURLToPath(new URL('./fixtures/balanz-holdings.xlsx', import.meta.url));

async function reason(file: File): Promise<string> {
  try {
    await parseBalanzXlsx(file);
  } catch (error) {
    return (error as { reason?: string }).reason ?? 'other';
  }
  return 'accepted';
}

async function workbook(sheet: string, rows: string[][]): Promise<File> {
  const data = rows.map((row) => row.map((value) => ({ value })));
  const blob = await writeExcelFile(data as never, { sheet } as never).toBlob();
  return new File([blob], 'holdings.xlsx');
}

describe('parseBalanzXlsx (DISC-001-07c FR-01)', () => {
  it('reads the anonymized Balanz sample end to end (AC-01)', async () => {
    const file = new File([readFileSync(SAMPLE)], 'balanz-holdings.xlsx');

    const holdings = await parseBalanzXlsx(file);

    expect(holdings.map((holding) => holding.ticker)).toEqual(['IBIT', 'SPY']);
    expect(holdings[0]).toMatchObject({
      instrumentType: 'cedear',
      valuationCurrency: 'ARS',
      quantity: '4600000000',
      unitPrice: '753500',
      totalCost: '41949600',
      pricedOn: '2026-10-09',
    });
    expect(holdings[1]).toMatchObject({ quantity: '200000000', totalCost: '3846400' });
  });

  it('rejects a workbook without the "Mis Instrumentos" sheet (AC-07)', async () => {
    const file = await workbook('Otra hoja', [['Ticker'], ['IBIT']]);

    expect(await reason(file)).toBe('wrongSheet');
  });

  it('rejects a workbook whose sheet lacks the header columns (AC-07)', async () => {
    const file = await workbook('Mis Instrumentos', [['Algo'], ['IBIT']]);

    expect(await reason(file)).toBe('missingColumns');
  });

  it.each([
    ['a CSV', new File(['ticker,precio\nIBIT,7535'], 'holdings.csv')],
    ['a PDF', new File(['%PDF-1.7 not a spreadsheet'], 'resumen.pdf')],
    ['an empty file', new File([], 'empty.xlsx')],
  ])('rejects %s as not an Excel file (AC-07)', async (_label, file) => {
    expect(await reason(file)).toBe('notExcel');
  });

  it('rejects a file above 1 MB before reading it (AC-08)', async () => {
    const file = new File([new Uint8Array(BALANZ_FILE_MAX_BYTES + 1)], 'big.xlsx');

    expect(await reason(file)).toBe('tooLarge');
  });
});
