import { planHoldingsImport } from '@pesly/shared';
import writeExcelFile from 'write-excel-file/universal';
import { describe, expect, it } from 'vitest';
import {
  parseBalanzRows,
  type BalanzCell,
} from '@/features/investments/balanz-import/parse-balanz-rows';
import {
  BALANZ_FILE_MAX_BYTES,
  parseBalanzXlsx,
} from '@/features/investments/balanz-import/parse-balanz-xlsx';

const HEADER = [
  'Ticker',
  'Tipo de Instrumento',
  'Descripcion',
  'Nominales',
  'Precio',
  'Fecha',
  'Precio promedio de compra',
  'Valor inicial',
];

function row(index: number): string[] {
  return [
    `T${index}`,
    'Cedears',
    `CEDEAR NUMERO ${index} DE PRUEBA`,
    '46',
    '7535.123',
    '09/10/2026',
    '9119.47561304',
    '419496',
  ];
}

describe('Balanz import size and speed (DISC-001-07c NFR-01)', () => {
  it('reads and plans 1,000 rows well under 5 seconds', () => {
    const rows: BalanzCell[][] = [HEADER, ...Array.from({ length: 1000 }, (_, i) => row(i))];
    const current = Array.from({ length: 500 }, (_, i) => ({
      id: `id-${i}`,
      ticker: `T${i * 2}`,
      instrumentType: 'cedear',
    }));

    const started = performance.now();
    const holdings = parseBalanzRows(rows);
    const plan = planHoldingsImport(current, holdings);
    const elapsed = performance.now() - started;

    expect(holdings).toHaveLength(1000);
    expect(plan.update.length + plan.create.length).toBe(1000);
    expect(elapsed).toBeLessThan(5000);
  });

  it('reads a real .xlsx of 1,000 rows under 1 MB in under 5 seconds', async () => {
    const data = [HEADER, ...Array.from({ length: 1000 }, (_, i) => row(i))].map((values) =>
      values.map((value) => ({ value })),
    );
    const blob = await writeExcelFile(
      data as never,
      { sheet: 'Mis Instrumentos' } as never,
    ).toBlob();
    const file = new File([blob], 'holdings.xlsx');
    expect(file.size).toBeLessThan(BALANZ_FILE_MAX_BYTES);

    const started = performance.now();
    const holdings = await parseBalanzXlsx(file);
    const elapsed = performance.now() - started;

    expect(holdings).toHaveLength(1000);
    expect(elapsed).toBeLessThan(5000);
  });
});
