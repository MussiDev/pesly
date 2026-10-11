import { describe, expect, it } from 'vitest';
import {
  mapInstrumentType,
  parseBalanzRows,
  type BalanzCell,
} from '@/features/investments/balanz-import/parse-balanz-rows';
import { BalanzParseError } from '@/features/investments/balanz-import/balanz-types';

const HEADER = [
  'Ticker',
  'Tipo de Instrumento',
  'Descripcion',
  'Nominales',
  'Garantías',
  'Precio',
  'Fecha',
  'Porcentaje de tenencia',
  'Precio promedio de compra',
  'Valor actual',
  'Valor inicial',
  'Rendimiento',
];

const IBIT = [
  'IBIT',
  'Cedears',
  'CEDEAR ISHARES BITCOIN TR (IBIT)',
  '46',
  '0',
  '7535',
  '09/10/2026',
  '87.22',
  '9119.47561304',
  '346610',
  '419496',
  '-72886',
];
const SPY = [
  'SPY',
  'Cedears',
  'CEDEAR SPDR S&P 500',
  '2',
  '0',
  '20970',
  '09/10/2026',
  '10.55',
  '19232.2386',
  '41940',
  '38464',
  '3476',
];

function sheet(...rows: BalanzCell[][]): BalanzCell[][] {
  return [HEADER, ...rows];
}

function withCell(row: BalanzCell[], column: string, value: BalanzCell): BalanzCell[] {
  const copy = [...row];
  copy[HEADER.indexOf(column)] = value;
  return copy;
}

function failure(rows: BalanzCell[][]): BalanzParseError {
  try {
    parseBalanzRows(rows);
  } catch (error) {
    if (error instanceof BalanzParseError) return error;
    throw error;
  }
  throw new Error('expected the rows to be rejected');
}

describe('parseBalanzRows (DISC-001-07c FR-01)', () => {
  it('reads the anonymized sample into scaled integers and the file day (AC-01)', () => {
    const holdings = parseBalanzRows(sheet(IBIT, SPY));

    expect(holdings).toEqual([
      {
        ticker: 'IBIT',
        instrumentName: 'CEDEAR ISHARES BITCOIN TR (IBIT)',
        instrumentType: 'cedear',
        valuationCurrency: 'ARS',
        quantity: '4600000000',
        totalCost: '41949600',
        unitPrice: '753500',
        pricedOn: '2026-10-09',
      },
      {
        ticker: 'SPY',
        instrumentName: 'CEDEAR SPDR S&P 500',
        instrumentType: 'cedear',
        valuationCurrency: 'ARS',
        quantity: '200000000',
        totalCost: '3846400',
        unitPrice: '2097000',
        pricedOn: '2026-10-09',
      },
    ]);
  });

  it('rounds a long decimal half up to the minor unit, without a float (AC-01)', () => {
    const [holding] = parseBalanzRows(
      sheet(withCell(withCell(IBIT, 'Valor inicial', '419496.4'), 'Precio', '9119.47561304')),
    );

    expect(holding?.totalCost).toBe('41949640');
    expect(holding?.unitPrice).toBe('911948');
  });

  it('rounds half up at the third decimal and keeps a fractional quantity to 8 places', () => {
    const [holding] = parseBalanzRows(
      sheet(withCell(withCell(IBIT, 'Nominales', '0.00000001'), 'Precio', '10.005')),
    );

    expect(holding?.quantity).toBe('1');
    expect(holding?.unitPrice).toBe('1001');
  });

  it('leaves the cost empty when "Valor inicial" is empty or 0', () => {
    const empty = parseBalanzRows(sheet(withCell(IBIT, 'Valor inicial', null)));
    const zero = parseBalanzRows(sheet(withCell(IBIT, 'Valor inicial', '0')));

    expect(empty[0]?.totalCost).toBeNull();
    expect(zero[0]?.totalCost).toBeNull();
  });

  it('finds the header below leading blank and title rows and ignores trailing blank rows', () => {
    const holdings = parseBalanzRows([[null], ['Mis instrumentos'], HEADER, IBIT, [null, ''], []]);

    expect(holdings).toHaveLength(1);
  });

  it('matches the header without accents or case and in any column order', () => {
    const shuffled = [...HEADER.keys()].reverse();
    const rows = [HEADER, IBIT].map((row) => shuffled.map((index) => row[index] ?? null));
    rows[0] = (rows[0] ?? []).map((cell) => String(cell).toUpperCase());

    expect(parseBalanzRows(rows)[0]?.ticker).toBe('IBIT');
  });

  it('reads a date cell as a day', () => {
    const [holding] = parseBalanzRows(
      sheet(withCell(IBIT, 'Fecha', new Date('2026-10-09T00:00:00Z'))),
    );

    expect(holding?.pricedOn).toBe('2026-10-09');
  });

  it('starts every holding in ARS, the choice of USD belongs to the preview (AC-09)', () => {
    expect(parseBalanzRows(sheet(IBIT, SPY)).map((holding) => holding.valuationCurrency)).toEqual([
      'ARS',
      'ARS',
    ]);
  });
});

describe('mapInstrumentType (DISC-001-07c FR-07)', () => {
  it.each([
    ['Cedears', 'cedear'],
    ['CEDEARS', 'cedear'],
    ['Acciones', 'stock'],
    ['Acciones Argentinas', 'stock'],
    ['Bonos', 'bond'],
    ['Bonos Soberanos', 'bond'],
    ['Títulos Públicos', 'bond'],
    ['Obligaciones Negociables', 'bond'],
    ['FCI', 'mutual_fund'],
    ['Fondos Comunes de Inversión', 'mutual_fund'],
    ['Plazo Fijo', 'fixed_term_deposit'],
    ['Letras', 'other'],
    ['Opciones', 'other'],
    ['', 'other'],
  ])('maps "%s" to %s (AC-10)', (text, expected) => {
    expect(mapInstrumentType(text)).toBe(expected);
  });

  it('imports an unrecognized type as "other" instead of rejecting the file (AC-10)', () => {
    const [holding] = parseBalanzRows(sheet(withCell(IBIT, 'Tipo de Instrumento', 'Warrants')));

    expect(holding?.instrumentType).toBe('other');
  });
});

describe('parseBalanzRows rejects the whole file (FR-04)', () => {
  it('names the missing columns, never a value (AC-05, AC-07)', () => {
    const rows = [HEADER.filter((name) => name !== 'Valor inicial' && name !== 'Fecha'), ['x']];

    const error = failure(rows);

    expect(error.reason).toBe('missingColumns');
    expect(error.detail).toBe('Fecha, Valor inicial');
  });

  it('rejects a sheet with no header row at all', () => {
    expect(
      failure([
        ['a', 'b'],
        ['1', '2'],
      ]).reason,
    ).toBe('missingColumns');
  });

  it('rejects a header with no holdings under it', () => {
    expect(failure([HEADER, [null]]).reason).toBe('empty');
    expect(failure([]).reason).toBe('empty');
  });

  it.each([
    ['a quantity of 0', 'Nominales', '0'],
    ['a negative quantity', 'Nominales', '-2'],
    ['a text quantity', 'Nominales', 'dos'],
    ['more than 8 decimals in the quantity', 'Nominales', '1.123456789'],
    ['a price of 0', 'Precio', '0'],
    ['a price that rounds to 0', 'Precio', '0.004'],
    ['a scientific number', 'Precio', '1E3'],
    ['a text price', 'Precio', 'caro'],
    ['a negative cost', 'Valor inicial', '-5'],
    ['a non-calendar date', 'Fecha', '30/02/2026'],
    ['an American date', 'Fecha', '10/09/2026-x'],
    ['a missing date', 'Fecha', null],
    ['a missing ticker', 'Ticker', null],
    ['a ticker with markup', 'Ticker', '<b>X</b>'],
    ['a missing name', 'Descripcion', null],
    ['a name above 100 characters', 'Descripcion', 'N'.repeat(101)],
  ])('rejects %s with the row number and no cell value (AC-05)', (_label, column, value) => {
    const error = failure(sheet(SPY, withCell(IBIT, column, value)));

    expect(error.reason).toBe('badRow');
    expect(error.detail).toBe('3');
  });

  it('accepts 1,000 holdings and rejects 1,001 (NFR-01)', () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) => withCell(IBIT, 'Ticker', `T${index}`));

    expect(parseBalanzRows(sheet(...rows(1000)))).toHaveLength(1000);
    expect(failure(sheet(...rows(1001))).reason).toBe('tooManyRows');
  });

  it('never puts a cell value in the error message', () => {
    const error = failure(sheet(withCell(IBIT, 'Nominales', 'secret-quantity')));

    expect(`${error.message} ${error.detail}`).not.toContain('secret-quantity');
    expect(`${error.message} ${error.detail}`).not.toContain('IBIT');
  });
});
