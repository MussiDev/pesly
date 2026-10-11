import {
  IMPORT_MAX_HOLDINGS,
  QUANTITY_SCALE,
  importHoldingSchema,
  parseScaledDecimal,
  type ImportHolding,
  type InstrumentType,
} from '@pesly/shared';
import { BalanzParseError } from './balanz-types';

export type BalanzCell = string | boolean | Date | null | undefined;
type Row = readonly BalanzCell[];

const DAY = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const DECIMAL = /^(\d{1,20})(?:\.(\d+))?$/;

/** The columns the file must have, in the order a missing one is reported. */
const REQUIRED = [
  'Ticker',
  'Tipo de Instrumento',
  'Descripcion',
  'Nominales',
  'Precio',
  'Fecha',
  'Precio promedio de compra',
  'Valor inicial',
] as const;
type Column = (typeof REQUIRED)[number];

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function text(cell: BalanzCell): string {
  if (cell === null || cell === undefined || typeof cell === 'boolean') return '';
  if (cell instanceof Date) return '';
  return cell.replace(/\s+/g, ' ').trim();
}

function isBlank(row: Row): boolean {
  return row.every((cell) => cell === null || cell === undefined || text(cell) === '');
}

/** The instrument type of PRD 07a for the file's "Tipo de Instrumento"; anything unknown is "other". */
export function mapInstrumentType(value: string): InstrumentType {
  const type = normalize(value);
  if (type.includes('cedear')) return 'cedear';
  if (type.includes('plazo fijo')) return 'fixed_term_deposit';
  if (type.includes('accion')) return 'stock';
  if (['bono', 'titulo', 'obligacion'].some((word) => type.includes(word))) return 'bond';
  if (type.includes('fondo') || type.includes('fci')) return 'mutual_fund';
  return 'other';
}

/** Minor units (2 decimals) of plain decimal text, rounded half up; no float is involved. */
function toMinorHalfUp(value: string): bigint | null {
  const match = DECIMAL.exec(value);
  if (!match) return null;
  const [, whole = '0', fraction = ''] = match;
  const minor = BigInt(whole + fraction.slice(0, 2).padEnd(2, '0'));
  return (fraction[2] ?? '0') >= '5' ? minor + 1n : minor;
}

/** `dd/mm/yyyy` text or a date cell to `YYYY-MM-DD`; null when it is not a real calendar day. */
function toDay(cell: BalanzCell): string | null {
  const pad = (value: number) => value.toString().padStart(2, '0');
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return null;
    return `${cell.getUTCFullYear()}-${pad(cell.getUTCMonth() + 1)}-${pad(cell.getUTCDate())}`;
  }
  const match = DAY.exec(text(cell));
  if (!match) return null;
  const [, day = '', month = '', year = ''] = match;
  const iso = `${year}-${month}-${day}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === iso ? iso : null;
}

function headerColumns(rows: readonly Row[]): { index: number; columns: Map<Column, number> } {
  const index = rows.findIndex((row) => row.some((cell) => normalize(text(cell)) === 'ticker'));
  if (index < 0) throw new BalanzParseError('missingColumns', REQUIRED.join(', '));
  const header = (rows[index] ?? []).map((cell) => normalize(text(cell)));
  const columns = new Map<Column, number>();
  const missing: string[] = [];
  for (const name of REQUIRED) {
    const at = header.indexOf(normalize(name));
    if (at < 0) missing.push(name);
    else columns.set(name, at);
  }
  if (missing.length > 0) throw new BalanzParseError('missingColumns', missing.join(', '));
  return { index, columns };
}

/**
 * Reads the rows of the sheet "Mis Instrumentos" into holdings. Numbers arrive as text, so every
 * amount is converted by string handling to integers (quantity x10^8, money in minor units, half
 * up). Any problem rejects the whole file; the error carries a column list or a row number only.
 */
export function parseBalanzRows(rows: readonly Row[]): ImportHolding[] {
  if (rows.length === 0) throw new BalanzParseError('empty');
  const { index, columns } = headerColumns(rows);

  const dataRows = rows
    .map((row, at) => ({ row, number: at + 1 }))
    .filter(({ row }, at) => at > index && !isBlank(row));
  if (dataRows.length === 0) throw new BalanzParseError('empty');
  if (dataRows.length > IMPORT_MAX_HOLDINGS) throw new BalanzParseError('tooManyRows');

  return dataRows.map(({ row, number }) => {
    const cell = (column: Column): BalanzCell => row[columns.get(column) ?? -1];
    const bad = () => new BalanzParseError('badRow', String(number));

    const quantity = parseScaledDecimal(text(cell('Nominales')), QUANTITY_SCALE);
    const unitPrice = toMinorHalfUp(text(cell('Precio')));
    const costText = text(cell('Valor inicial'));
    const cost = costText === '' ? 0n : toMinorHalfUp(costText);
    const pricedOn = toDay(cell('Fecha'));
    if (quantity === null || unitPrice === null || cost === null || pricedOn === null) throw bad();

    const parsed = importHoldingSchema.safeParse({
      ticker: text(cell('Ticker')),
      instrumentName: text(cell('Descripcion')),
      instrumentType: mapInstrumentType(text(cell('Tipo de Instrumento'))),
      valuationCurrency: 'ARS',
      quantity: quantity.toString(),
      totalCost: cost === 0n ? null : cost.toString(),
      unitPrice: unitPrice.toString(),
      pricedOn,
    });
    if (!parsed.success) throw bad();
    return parsed.data;
  });
}
