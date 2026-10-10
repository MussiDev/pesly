import { readSheet } from 'read-excel-file/browser';
import { parseStatementRows, type StatementCell } from './parse-statement-rows';
import { StatementParseError, type ParsedStatement, type StatementParser } from './statement-types';

export const STATEMENT_FILE_MAX_BYTES = 2 * 1024 * 1024;

/** Reads the first sheet of an `.xlsx` statement in the browser; the file never leaves the device. */
export async function parseStatementXlsx(file: File): Promise<ParsedStatement> {
  if (file.size > STATEMENT_FILE_MAX_BYTES) throw new StatementParseError('tooLarge');
  let rows: readonly (readonly StatementCell[])[];
  try {
    const sheet = await readSheet(file);
    // The library types a cell as possibly the `Date` constructor; no real cell is one.
    rows = sheet.map((row) => row.map((cell) => (typeof cell === 'function' ? null : cell)));
  } catch {
    throw new StatementParseError('unreadable');
  }
  return parseStatementRows(rows);
}

export const xlsxStatementParser: StatementParser = {
  accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  parse: parseStatementXlsx,
};
