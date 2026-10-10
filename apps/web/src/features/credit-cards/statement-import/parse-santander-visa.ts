import { parseStatementAmount, parseStatementDate } from './parse-statement-rows';
import { lineText, type PdfLine, type PdfTextItem } from './pdf-lines';
import {
  StatementParseError,
  type ParsedStatement,
  type ParsedStatementLine,
  type StatementCurrency,
  type StatementLineKind,
} from './statement-types';

const SHORT_DATE = /^(\d{2})\/(\d{2})\/(\d{2})$/;
const SYMBOL = /^-?(?:U\$S|US\$|\$)-?$/i;
const NUMBER = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/;
const GLUED = /^-?(?:U\$S|US\$|\$)-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/i;
const CARD_ENDING = /terminada\s+en\s+(\d{4})/i;
const INSTALLMENT = /^(\d{1,3})\s*de\s*(\d{1,3})$/i;
const COLUMN_TOLERANCE = 8;

/** `24/09/26` to `2026-09-24`; two-digit years are 20yy. */
export function parseShortDate(word: string): string | null {
  const match = SHORT_DATE.exec(word);
  if (!match) return null;
  return parseStatementDate(`${match[1]}/${match[2]}/20${match[3]}`);
}

/** Whether the lines are a Santander "Resumen Visa", by its fixed markers. */
export function isSantanderVisaStatement(lines: readonly PdfLine[]): boolean {
  const texts = lines.map(lineText);
  return (
    texts.some((text) => /^Resumen\s+Visa\b/i.test(text)) &&
    texts.some((text) => /^Total a pagar\b/i.test(text)) &&
    texts.some((text) => /Monto en pesos/i.test(text))
  );
}

interface FoundAmount {
  /** Index of the first word of the amount in the line. */
  start: number;
  length: number;
  minor: string;
  currency: StatementCurrency;
}

/**
 * The amounts of a line: a currency symbol followed by a number (`$ 7.339,97`, `U$S 20,00`,
 * `-$ 954.428,29`). The symbol decides the currency; a number without a symbol (such as the
 * `981.474,99` inside a description) is not an amount.
 */
function findAmounts(words: readonly PdfTextItem[]): FoundAmount[] {
  const found: FoundAmount[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]?.text ?? '';
    const next = words[index + 1]?.text ?? '';
    let text: string | null = null;
    let length = 1;
    if (GLUED.test(word)) text = word;
    else if (SYMBOL.test(word) && NUMBER.test(next)) {
      text = `${word} ${next}`;
      length = 2;
    }
    if (text === null) continue;
    const parsed = parseStatementAmount(text);
    if (parsed.currency === null) continue;
    found.push({ start: index, length, minor: parsed.minor, currency: parsed.currency });
    index += length - 1;
  }
  return found;
}

interface Columns {
  description: number;
  installment: number;
  voucher: number;
}

type Section = 'payment' | 'purchase' | 'fee';

const KIND_OF: Record<Section, StatementLineKind> = {
  payment: 'payment',
  purchase: 'purchase',
  fee: 'fee',
};

/**
 * Reads the lines of a Santander "Resumen Visa" (text layer of the PDF). The dates come from the
 * Período table, the lines from the sections `Pago anterior y devoluciones`, `Movimientos de ...`
 * and `Impuestos, intereses y percepciones`, and the total to reconcile with from `Total a pagar`.
 * Currencies come from the symbol of each amount; the cuota and comprobante columns are found by
 * the x of their header, which repeats on every page.
 */
export function parseSantanderVisaLines(lines: readonly PdfLine[]): ParsedStatement {
  if (!isSantanderVisaStatement(lines)) throw new StatementParseError('unrecognizedFormat');

  // Period table: previous closing, previous due, closing, due, next closing, next due.
  const dates = lines
    .map((line) => line.map((word) => parseShortDate(word.text)))
    .find((row) => row.length >= 6 && row.every((date) => date !== null));
  const closingDate = dates?.[2] ?? null;
  const dueDate = dates?.[3] ?? null;
  if (closingDate === null || dueDate === null) throw new StatementParseError('unrecognized');

  let cardEnding: string | null = null;
  const totals: Record<StatementCurrency, string | null> = { ARS: null, USD: null };
  const parsed: ParsedStatementLine[] = [];

  let section: Section | null = null;
  let columns: Columns | null = null;
  let lastDate: string | null = null;
  let previous: ParsedStatementLine | null = null;

  for (const line of lines) {
    const text = lineText(line);
    cardEnding ??= CARD_ENDING.exec(text)?.[1] ?? null;
    const amounts = findAmounts(line);

    if (/^Pago anterior y devoluciones/i.test(text)) {
      section = 'payment';
      columns = null;
      previous = null;
      lastDate = null;
      continue;
    }
    if (/^Movimientos de\b/i.test(text)) {
      section = 'purchase';
      columns = null;
      previous = null;
      lastDate = null;
      continue;
    }
    if (/^Impuestos, intereses y percepciones/i.test(text)) {
      section = 'fee';
      columns = null;
      previous = null;
      lastDate = null;
      continue;
    }
    if (section === null) continue;

    if (/^Total a pagar\b/i.test(text) && amounts.length > 0) {
      for (const amount of amounts) totals[amount.currency] = amount.minor;
      break;
    }
    if (/^Fecha\b/i.test(text) && /Descripci/i.test(text)) {
      const at = (pattern: RegExp) => line.find((word) => pattern.test(word.text))?.x;
      const description = at(/^Descripci/i);
      columns =
        description === undefined
          ? null
          : {
              description,
              installment: at(/^Cuota$/i) ?? Number.POSITIVE_INFINITY,
              voucher: at(/^Comprobante$/i) ?? Number.POSITIVE_INFINITY,
            };
      previous = null;
      continue;
    }
    if (/^(Subtotal de|Total consumido|M[ií]nimo a pagar)\b/i.test(text)) {
      previous = null;
      continue;
    }
    if (columns === null) continue;

    const first = line[0];
    if (first === undefined) continue;
    const date = parseShortDate(first.text);

    if (amounts.length === 0) {
      // A row with no date and no amount continues the description of the row above it.
      if (date === null && previous !== null && first.x >= columns.description - COLUMN_TOLERANCE) {
        previous.description = `${previous.description} ${text}`.trim();
      } else {
        previous = null;
      }
      continue;
    }

    const rowDate: string | null = date ?? lastDate ?? (section === 'fee' ? closingDate : null);
    if (rowDate === null) throw new StatementParseError('invalidRow');
    lastDate = rowDate;

    const inAmount = new Set(
      amounts.flatMap((a) => Array.from({ length: a.length }, (_, i) => a.start + i)),
    );
    const rest = line.filter((_, index) => !inAmount.has(index) && !(date !== null && index === 0));
    const band = (from: number, to: number) =>
      rest.filter((word) => word.x >= from - COLUMN_TOLERANCE && word.x < to - COLUMN_TOLERANCE);
    const installmentWords = band(columns.installment, columns.voucher);
    const installmentText = installmentWords.map((word) => word.text).join(' ');
    const installment = INSTALLMENT.exec(installmentText);
    const voucherWords = band(columns.voucher, Number.POSITIVE_INFINITY);
    const voucherText = voucherWords.map((word) => word.text).join('');
    const voucher = /^\d{3,}$/.test(voucherText) ? voucherText : '';
    // A long description can reach into a column band: whatever is not a cuota or a voucher is
    // still part of the description.
    const descriptionWords = rest.filter(
      (word) =>
        !/^(?:U\$S|US\$|\$)$/i.test(word.text) &&
        (installment === null || !installmentWords.includes(word)) &&
        (voucher === '' || !voucherWords.includes(word)),
    );
    const description = descriptionWords
      .map((word) => word.text)
      .join(' ')
      .trim();
    if (description === '') throw new StatementParseError('invalidRow');
    // The previous balance rows are not movements.
    if (/^saldo\b/i.test(description)) {
      previous = null;
      continue;
    }

    let installmentNumber: number | null = null;
    let installmentCount: number | null = null;
    if (installment !== null) {
      const number = Number(installment[1]);
      const count = Number(installment[2]);
      if (number < 1 || number > count) throw new StatementParseError('invalidRow');
      // "1 de 1" is a plain purchase.
      if (count >= 2) {
        installmentNumber = number;
        installmentCount = count;
      }
    }

    previous = null;
    for (const amount of amounts) {
      if (BigInt(amount.minor) === 0n) continue;
      const kind: StatementLineKind =
        section === 'payment' || amount.minor.startsWith('-') ? 'payment' : KIND_OF[section];
      const row: ParsedStatementLine = {
        date: rowDate,
        description,
        voucher: voucher === '' ? null : voucher,
        installmentNumber: kind === 'payment' ? null : installmentNumber,
        installmentCount: kind === 'payment' ? null : installmentCount,
        currency: amount.currency,
        amount: amount.minor,
        kind,
      };
      parsed.push(row);
      previous = row;
    }
  }

  if (!parsed.some((row) => row.kind !== 'payment')) throw new StatementParseError('noLines');
  return { closingDate, dueDate, cardEnding, totals, lines: parsed };
}
