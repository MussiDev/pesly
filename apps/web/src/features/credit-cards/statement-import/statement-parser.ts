import { pdfStatementParser } from './parse-statement-pdf';
import { xlsxStatementParser } from './parse-statement-xlsx';
import { StatementParseError, type StatementParser } from './statement-types';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The parser for a file, by its MIME type or extension; `null` when it is neither. */
export function parserForFile(file: File): StatementParser | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return pdfStatementParser;
  if (file.type === XLSX_MIME || name.endsWith('.xlsx')) return xlsxStatementParser;
  return null;
}

/**
 * The parser the import screen uses: it accepts Excel and PDF files and hands each one to the
 * parser of its type. Both MIME types and extensions go in `accept` because mobile browsers
 * sometimes report an empty or generic type for files from the cloud pickers.
 */
export const statementParser: StatementParser = {
  accept: `${xlsxStatementParser.accept},${pdfStatementParser.accept}`,
  parse(file, options) {
    const parser = parserForFile(file);
    return parser === null
      ? Promise.reject(new StatementParseError('unreadable'))
      : parser.parse(file, options);
  },
};
