/** Why a Balanz file cannot be read; the reason picks the translated message. */
export type BalanzParseReason =
  | 'notExcel'
  | 'tooLarge'
  | 'wrongSheet'
  | 'missingColumns'
  | 'badRow'
  | 'tooManyRows'
  | 'empty'
  | 'unreadable';

/**
 * `detail` is only column names or a row number, never a cell value: the file holds the user's
 * financial data and an error can end up in a log.
 */
export class BalanzParseError extends Error {
  constructor(
    readonly reason: BalanzParseReason,
    readonly detail?: string,
  ) {
    super(reason);
    this.name = 'BalanzParseError';
  }
}

export const BALANZ_SHEET = 'Mis Instrumentos';
