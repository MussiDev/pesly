import {
  StatementParseError,
  type ParsedStatement,
  type ParsedStatementLine,
  type StatementCurrency,
  type StatementLineKind,
} from './statement-types';

export type StatementCell = string | number | boolean | Date | null | undefined;

const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const INSTALLMENT = /^(\d{1,3})\s*de\s*(\d{1,3})$/i;
const CARD_ENDING = /terminad[ao]\s+en\s+(\d{4})/i;
const AMOUNT = /^(-)?\s*(U\$S|US\$|\$)?\s*(-)?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/i;
const PLAIN_NUMBER = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

function dmy(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

function text(cell: StatementCell): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return dmy(cell);
  return String(cell).replace(/\s+/g, ' ').trim();
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** `dd/mm/yyyy` to `YYYY-MM-DD`; `null` when it is not a real calendar day. */
export function parseStatementDate(value: string): string | null {
  const match = DATE.exec(value);
  if (!match) return null;
  const [, day = '', month = '', year = ''] = match;
  const check = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const valid =
    check.getUTCFullYear() === Number(year) &&
    check.getUTCMonth() === Number(month) - 1 &&
    check.getUTCDate() === Number(day);
  return valid ? `${year}-${month}-${day}` : null;
}

export interface ParsedAmount {
  /** `null` when the text carries no currency symbol. */
  currency: StatementCurrency | null;
  minor: string;
}

function toMinor(negative: boolean, whole: string, cents: string | undefined): string {
  const value = BigInt(`${whole}${(cents ?? '').padEnd(2, '0')}`);
  return value === 0n ? '0' : `${negative ? '-' : ''}${value.toString()}`;
}

/**
 * `$1.234,50`, `U$S20,00`, `$-954.428,29` and numeric cells to a minor-unit integer string, by
 * string handling only: money never goes through a float.
 */
export function parseStatementAmount(cell: StatementCell): ParsedAmount {
  if (typeof cell === 'number') {
    const plain = PLAIN_NUMBER.exec(String(cell));
    if (!plain) throw new StatementParseError('invalidAmount');
    return { currency: null, minor: toMinor(plain[1] === '-', plain[2] ?? '0', plain[3]) };
  }
  const match = AMOUNT.exec(text(cell));
  if (!match) throw new StatementParseError('invalidAmount');
  const [, lead, symbol, trail, whole, cents] = match;
  const currency = symbol === undefined ? null : symbol === '$' ? 'ARS' : 'USD';
  return {
    currency,
    minor: toMinor(lead === '-' || trail === '-', (whole ?? '0').replaceAll('.', ''), cents),
  };
}

type Row = readonly StatementCell[];

function isBlank(row: Row): boolean {
  return row.every((cell) => text(cell) === '');
}

function firstText(row: Row): string {
  return row.map(text).find((value) => value !== '') ?? '';
}

function columnOf(row: Row, pattern: RegExp): number {
  return row.findIndex((cell) => pattern.test(normalize(text(cell))));
}

function cellAt(row: Row, index: number): StatementCell {
  return index < 0 ? null : row[index];
}

interface Columns {
  date: number;
  description: number;
  installments: number;
  voucher: number;
  ars: number;
  usd: number;
}

function purchaseColumns(row: Row): Columns | null {
  const columns: Columns = {
    date: columnOf(row, /^fecha$/),
    description: columnOf(row, /^descripcion$/),
    installments: columnOf(row, /^cuotas$/),
    voucher: columnOf(row, /^comprobante$/),
    ars: columnOf(row, /^monto en pesos$/),
    usd: columnOf(row, /^monto en dolares$/),
  };
  return columns.date >= 0 && columns.description >= 0 && (columns.ars >= 0 || columns.usd >= 0)
    ? columns
    : null;
}

function feeColumns(row: Row): Columns | null {
  const description = columnOf(row, /^descripcion$/);
  const ars = columnOf(row, /^monto en pesos$/);
  if (description < 0 || ars < 0 || columnOf(row, /^fecha$/) >= 0) return null;
  return { date: -1, description, installments: -1, voucher: -1, ars, usd: -1 };
}

/** The amount of a row: one of the two amount columns, its currency from the symbol. */
function rowAmount(
  row: Row,
  columns: Columns,
): (ParsedAmount & { currency: StatementCurrency }) | null {
  const candidates = [
    { cell: cellAt(row, columns.ars), column: 'ARS' as const },
    { cell: cellAt(row, columns.usd), column: 'USD' as const },
  ].filter(({ cell }) => text(cell) !== '');
  if (candidates.length === 0) return null;
  const [only, ...rest] = candidates;
  if (only === undefined || rest.length > 0) throw new StatementParseError('invalidRow');
  const parsed = parseStatementAmount(only.cell);
  return { ...parsed, currency: parsed.currency ?? only.column };
}

function readTotals(row: Row): Record<StatementCurrency, string | null> {
  const totals: Record<StatementCurrency, string | null> = { ARS: null, USD: null };
  for (const cell of row) {
    if (text(cell) === '') continue;
    const parsed = parseStatementAmount(cell);
    if (parsed.currency !== null) totals[parsed.currency] = parsed.minor;
  }
  return totals;
}

function readInstallments(raw: string): { number: number | null; count: number | null } {
  if (raw === '' || raw === '-') return { number: null, count: null };
  const match = INSTALLMENT.exec(raw);
  if (!match) throw new StatementParseError('invalidRow');
  const number = Number(match[1]);
  const count = Number(match[2]);
  if (number < 1 || number > count) throw new StatementParseError('invalidRow');
  // "1 de 1" is a plain purchase.
  return count >= 2 ? { number, count } : { number: null, count: null };
}

type Mode = 'purchase' | 'payment' | 'fee';

interface Table {
  mode: Mode;
  columns: Columns;
}

/**
 * Reads the rows of a card statement sheet. Sections are found by their labels, never by row
 * number: the dates under "Fecha de cierre", the totals under "Total a pagar", the payments
 * section, one purchase table per card and the "Otros conceptos" table.
 */
export function parseStatementRows(rows: readonly Row[]): ParsedStatement {
  let closingDate: string | null = null;
  let dueDate: string | null = null;
  let cardEnding: string | null = null;
  let totals: Record<StatementCurrency, string | null> = { ARS: null, USD: null };
  const lines: ParsedStatementLine[] = [];

  let upcoming: Mode | null = null;
  let table: Table | null = null;
  let lastDate: string | null = null;

  for (const [index, row] of rows.entries()) {
    if (isBlank(row)) continue;
    const label = normalize(firstText(row));

    const purchaseHeader = purchaseColumns(row);
    const feeHeader = purchaseHeader ? null : feeColumns(row);
    if (purchaseHeader || feeHeader) {
      table = purchaseHeader
        ? { mode: upcoming === 'payment' ? 'payment' : 'purchase', columns: purchaseHeader }
        : { mode: 'fee', columns: feeHeader as Columns };
      upcoming = null;
      lastDate = null;
      continue;
    }

    if (label.startsWith('fecha de cierre')) {
      const dates = rows.slice(index + 1).find((next) => !isBlank(next));
      const dueAt = columnOf(row, /^fecha de vencimiento/);
      if (dates) {
        closingDate = parseStatementDate(text(cellAt(dates, columnOf(row, /^fecha de cierre/))));
        dueDate = dueAt >= 0 ? parseStatementDate(text(cellAt(dates, dueAt))) : null;
      }
      continue;
    }
    if (label.startsWith('total a pagar')) {
      const amounts = rows.slice(index + 1).find((next) => !isBlank(next));
      if (amounts) totals = readTotals(amounts);
      continue;
    }
    if (cardEnding === null && table === null) {
      cardEnding = CARD_ENDING.exec(firstText(row))?.[1] ?? null;
    }

    const single = row.filter((cell) => text(cell) !== '').length === 1;
    if (label.startsWith('pago de tarjeta')) {
      upcoming = 'payment';
      table = null;
      continue;
    }
    if (label.startsWith('otros conceptos')) {
      upcoming = 'fee';
      table = null;
      continue;
    }
    const active: Table | null = table;
    if (label.startsWith('total de') || (single && active !== null && active.mode !== 'fee')) {
      table = null;
      continue;
    }
    if (active === null) {
      // A card's title row between sections cancels a label that got no table.
      if (single) upcoming = null;
      continue;
    }

    const { columns } = active;
    const amount = rowAmount(row, columns);
    if (amount === null || BigInt(amount.minor) === 0n) continue;

    const description = text(cellAt(row, columns.description));
    if (description === '') throw new StatementParseError('invalidRow');

    let date: string | null;
    if (active.mode === 'fee') {
      date = closingDate;
    } else {
      const dateText = text(cellAt(row, columns.date));
      date = dateText === '' ? lastDate : parseStatementDate(dateText);
      if (date === null) throw new StatementParseError('invalidRow');
      lastDate = date;
    }
    if (date === null) throw new StatementParseError('unrecognized');

    const installments = readInstallments(text(cellAt(row, columns.installments)));
    const voucher = text(cellAt(row, columns.voucher));
    const kind: StatementLineKind =
      active.mode === 'payment' || amount.minor.startsWith('-')
        ? 'payment'
        : active.mode === 'fee'
          ? 'fee'
          : 'purchase';

    lines.push({
      date,
      description,
      voucher: voucher === '' || voucher === '-' ? null : voucher,
      installmentNumber: kind === 'payment' ? null : installments.number,
      installmentCount: kind === 'payment' ? null : installments.count,
      currency: amount.currency,
      amount: amount.minor,
      kind,
    });
  }

  if (closingDate === null || dueDate === null) throw new StatementParseError('unrecognized');
  if (!lines.some((line) => line.kind !== 'payment')) throw new StatementParseError('noLines');
  return { closingDate, dueDate, cardEnding, totals, lines };
}
