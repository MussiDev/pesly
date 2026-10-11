import { readSheet, SheetNotFoundError } from 'read-excel-file/browser';
import type { ImportHolding } from '@pesly/shared';
import { BALANZ_SHEET, BalanzParseError } from './balanz-types';
import { parseBalanzRows, type BalanzCell } from './parse-balanz-rows';
import { assertZipWithinLimits } from './zip-limits';

export const BALANZ_FILE_MAX_BYTES = 1024 * 1024;

/**
 * Reads the sheet "Mis Instrumentos" of a Balanz holdings export in the browser: the file never
 * leaves the device and nothing is stored. Numeric cells arrive as their own text, so no float is
 * ever created, and formulas are read as text, never evaluated.
 */
export async function parseBalanzXlsx(file: File): Promise<ImportHolding[]> {
  if (file.size > BALANZ_FILE_MAX_BYTES) throw new BalanzParseError('tooLarge');
  const buffer = await file.arrayBuffer();
  assertZipWithinLimits(buffer);

  let rows: readonly (readonly BalanzCell[])[];
  try {
    const sheet = await readSheet<string>(buffer, BALANZ_SHEET, { parseNumber: (cell) => cell });
    // The library types a cell as possibly the `Date` constructor; no real cell is one.
    rows = sheet.map((row) => row.map((cell) => (typeof cell === 'function' ? null : cell)));
  } catch (error) {
    if (error instanceof SheetNotFoundError) throw new BalanzParseError('wrongSheet');
    throw new BalanzParseError('unreadable');
  }
  return parseBalanzRows(rows);
}
