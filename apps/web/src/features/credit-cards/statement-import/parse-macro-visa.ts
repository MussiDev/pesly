import { lineText, type PdfLine, type PdfTextItem } from './pdf-lines';
import {
  StatementParseError,
  type ParsedStatement,
  type ParsedStatementLine,
  type StatementCurrency,
  type StatementLineKind,
} from './statement-types';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const TEXT_DATE = /(\d{1,2})\s+(Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)\s+(\d{2})\b/i;
const NUMERIC_DATE = /^(\d{2})\.(\d{2})\.(\d{2})$/;
/** `29.883,27`, `29.913,15-` (trailing minus) and `-,--` (no amount). */
const AMOUNT_WORD = /^(?:(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})(-?)|-,--)$/;
const VOUCHER = /^\d{3,}\*?$/;
const INSTALLMENT = /\bCuota\s+(\d{1,3})\/(\d{1,3})\b/i;
const FEE = /IMPUESTO|\bIVA\b|IIBB|PERCEP|DB\.?\s*RG|COMISION|INTERES|SELLOS|SEGURO/i;
const CARD_TOTAL = /^Tarjeta\s+(\d{4})\b/i;

/** The glyphs the bank prints before or after a description; never part of it. */
const CURRENCY_GLYPHS = new Set(['$', 'U$S', 'US$']);

function isRealDate(year: number, month: number, day: number): boolean {
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

function iso(year2: string, month: number, day: number): string | null {
  const year = 2000 + Number(year2);
  if (!isRealDate(year, month, day)) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** `24 Sep 26` (anywhere in the text) to `2026-09-24`; two-digit years are 20yy. */
export function parseSpanishTextDate(text: string): string | null {
  const match = TEXT_DATE.exec(text);
  if (!match) return null;
  const [, day = '', month = '', year = ''] = match;
  return iso(year, MONTHS.indexOf(month.toLowerCase()) + 1, Number(day));
}

/** `11.05.26` to `2026-05-11`. */
export function parseNumericDate(word: string): string | null {
  const match = NUMERIC_DATE.exec(word);
  if (!match) return null;
  const [, day = '', month = '', year = ''] = match;
  return iso(year, Number(month), Number(day));
}

/**
 * `29.883,27` to `'2988327'`, `29.913,15-` to `'-2991315'`, `-,--` to `'0'`; `null` when the
 * word is not an amount. String handling only: money never goes through a float.
 */
export function parseMacroAmount(word: string): string | null {
  const match = AMOUNT_WORD.exec(word);
  if (!match) return null;
  const [, whole, cents, minus] = match;
  if (whole === undefined || cents === undefined) return '0';
  const value = BigInt(`${whole.replaceAll('.', '')}${cents}`);
  return value === 0n ? '0' : `${minus === '-' ? '-' : ''}${value.toString()}`;
}

/** Whether the lines are a Banco Macro Visa statement, by its two fixed markers. */
export function isMacroVisaStatement(lines: readonly PdfLine[]): boolean {
  const texts = lines.map(lineText);
  return (
    texts.some((text) => /CIERRE\s+ACTUAL/i.test(text)) &&
    texts.some((text) => /FECHA\s+COMPROBANTE\s+DETALLE/i.test(text))
  );
}

/** Right edges of the `PESOS` and `DOLARES` header words, the reference for the amount columns. */
interface Columns {
  pesosEnd: number;
  dollarsEnd: number;
}

function findColumns(header: PdfLine): Columns {
  const pesos = header.find((item) => /^PESOS$/i.test(item.text));
  const dollars = header.find((item) => /^DOLARES$/i.test(item.text));
  if (pesos === undefined || dollars === undefined) throw new StatementParseError('unrecognized');
  return { pesosEnd: pesos.xEnd, dollarsEnd: dollars.xEnd };
}

/** The amount belongs to the column whose header's right edge is closer to its own right edge. */
function columnCurrency(word: PdfTextItem, columns: Columns): StatementCurrency {
  const middle = (columns.pesosEnd + columns.dollarsEnd) / 2;
  return word.xEnd <= middle ? 'ARS' : 'USD';
}

interface Amount {
  minor: string;
  currency: StatementCurrency;
}

function amountsOf(line: PdfLine, columns: Columns, useGlyphs: boolean): Amount[] {
  const amounts: Amount[] = [];
  for (const [index, word] of line.entries()) {
    const minor = parseMacroAmount(word.text);
    if (minor === null) continue;
    const glyph = line[index - 1]?.text;
    const currency =
      useGlyphs && glyph !== undefined && CURRENCY_GLYPHS.has(glyph)
        ? glyph === '$'
          ? 'ARS'
          : 'USD'
        : columnCurrency(word, columns);
    amounts.push({ minor, currency });
  }
  return amounts;
}

function parseRow(line: PdfLine, columns: Columns): ParsedStatementLine | null {
  const [first, ...rest] = line;
  if (first === undefined) return null;
  const date = parseNumericDate(first.text);
  if (date === null) return null;

  const amounts = amountsOf(rest, columns, false).filter((amount) => BigInt(amount.minor) !== 0n);
  // Rows with only zero or empty amounts carry nothing to import.
  if (amounts.length === 0) return null;
  const [amount, ...others] = amounts;
  if (amount === undefined || others.length > 0) throw new StatementParseError('invalidRow');

  const voucherWord = rest[0] !== undefined && VOUCHER.test(rest[0].text) ? rest[0].text : null;
  const descriptionWords = (voucherWord === null ? rest : rest.slice(1))
    .filter((word) => parseMacroAmount(word.text) === null && !CURRENCY_GLYPHS.has(word.text))
    .map((word) => word.text);
  const raw = descriptionWords.join(' ');
  const installment = INSTALLMENT.exec(raw);
  const description = raw.replace(INSTALLMENT, '').replace(/\s+/g, ' ').trim();
  if (description === '') throw new StatementParseError('invalidRow');

  let number: number | null = null;
  let count: number | null = null;
  if (installment !== null) {
    const parsedNumber = Number(installment[1]);
    const parsedCount = Number(installment[2]);
    if (parsedNumber < 1 || parsedNumber > parsedCount) throw new StatementParseError('invalidRow');
    // "01/01" is a plain purchase.
    if (parsedCount >= 2) {
      number = parsedNumber;
      count = parsedCount;
    }
  }

  const kind: StatementLineKind = amount.minor.startsWith('-')
    ? 'payment'
    : voucherWord === null && FEE.test(description)
      ? 'fee'
      : 'purchase';

  return {
    date,
    description,
    voucher: voucherWord,
    installmentNumber: kind === 'payment' ? null : number,
    installmentCount: kind === 'payment' ? null : count,
    currency: amount.currency,
    amount: amount.minor,
    kind,
  };
}

/**
 * NOT YET VERIFIED against a real file: built from a screenshot of the layout (the real PDF is
 * password-protected and could not be inspected). Reads the lines of a Banco Macro Visa statement (text layer of the PDF, grouped by
 * `groupItemsIntoLines`). The header block gives the dates, the detail table between its header
 * and `SALDO ACTUAL` gives the lines, and `SALDO ACTUAL` is the total to reconcile with. The
 * `Cuotas a vencer` schedule, the legal text and the direct-debit line are never read.
 */
export function parseMacroVisaLines(lines: readonly PdfLine[]): ParsedStatement {
  if (!isMacroVisaStatement(lines)) throw new StatementParseError('unrecognizedFormat');
  const texts = lines.map(lineText);

  const closing = texts
    .map((text) => /CIERRE\s+ACTUAL\s*:?\s*(.*)$/i.exec(text)?.[1])
    .find((rest) => rest !== undefined);
  const closingDate = closing === undefined ? null : parseSpanishTextDate(closing);

  // The due date is the first date after the `VENCIMIENTO | SALDO ...` header of the summary table.
  const summary = texts.findIndex(
    (text) => /\bVENCIMIENTO\b/i.test(text) && /SALDO/i.test(text) && !/VTO|PROXIMO/i.test(text),
  );
  const dueDate =
    summary < 0
      ? null
      : (texts
          .slice(summary + 1, summary + 4)
          .map(parseSpanishTextDate)
          .find((date) => date !== null) ?? null);
  if (closingDate === null || dueDate === null) throw new StatementParseError('unrecognized');

  const headerIndex = texts.findIndex((text) => /FECHA\s+COMPROBANTE\s+DETALLE/i.test(text));
  const header = lines[headerIndex];
  if (header === undefined) throw new StatementParseError('unrecognizedFormat');
  const columns = findColumns(header);

  let cardEnding: string | null = null;
  const totals: Record<StatementCurrency, string | null> = { ARS: null, USD: null };
  const parsed: ParsedStatementLine[] = [];

  for (const [offset, line] of lines.slice(headerIndex + 1).entries()) {
    const text = texts[headerIndex + 1 + offset] ?? '';
    if (/^SALDO\s+ACTUAL\b/i.test(text)) {
      for (const amount of amountsOf(line, columns, true)) totals[amount.currency] = amount.minor;
      break;
    }
    const card = CARD_TOTAL.exec(text);
    if (card !== null) {
      cardEnding ??= card[1] ?? null;
      continue;
    }
    const row = parseRow(line, columns);
    if (row !== null) parsed.push(row);
  }

  if (!parsed.some((row) => row.kind !== 'payment')) throw new StatementParseError('noLines');
  return { closingDate, dueDate, cardEnding, totals, lines: parsed };
}
