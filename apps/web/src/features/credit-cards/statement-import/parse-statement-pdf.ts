import { extractPdfLines } from './extract-pdf-lines';
import { isMacroVisaStatement, parseMacroVisaLines } from './parse-macro-visa';
import { isSantanderVisaStatement, parseSantanderVisaLines } from './parse-santander-visa';
import type { PdfLine } from './pdf-lines';
import {
  StatementParseError,
  type ParsedStatement,
  type StatementParseOptions,
  type StatementParser,
} from './statement-types';

export const STATEMENT_PDF_MAX_BYTES = 5 * 1024 * 1024;

interface BankFormat {
  matches(lines: readonly PdfLine[]): boolean;
  parse(lines: readonly PdfLine[]): ParsedStatement;
}

/** One entry per supported bank statement layout; add the next bank here. */
const FORMATS: readonly BankFormat[] = [
  { matches: isSantanderVisaStatement, parse: parseSantanderVisaLines },
  { matches: isMacroVisaStatement, parse: parseMacroVisaLines },
];

/** Picks the layout by its markers and parses the lines; nothing matching is an error. */
export function parsePdfStatementLines(lines: readonly PdfLine[]): ParsedStatement {
  // A scanned statement has no text layer: pages without any text item give no lines at all.
  if (lines.length === 0) {
    throw new StatementParseError('noTextLayer');
  }
  const format = FORMATS.find((candidate) => candidate.matches(lines));
  if (format === undefined) throw new StatementParseError('unrecognizedFormat');
  return format.parse(lines);
}

/** Reads a bank's PDF statement in the browser; the file never leaves the device. */
export async function parseStatementPdf(
  file: File,
  options: StatementParseOptions = {},
): Promise<ParsedStatement> {
  if (file.size > STATEMENT_PDF_MAX_BYTES) throw new StatementParseError('tooLarge');
  let data: ArrayBuffer;
  try {
    data = await file.arrayBuffer();
  } catch {
    throw new StatementParseError('unreadable');
  }
  return parsePdfStatementLines(await extractPdfLines(data, undefined, options.password));
}

export const pdfStatementParser: StatementParser = {
  accept: '.pdf,application/pdf',
  parse: parseStatementPdf,
};
