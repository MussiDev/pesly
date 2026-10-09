export type StatementCurrency = 'ARS' | 'USD';

/** `payment` lines (payments and refunds of the previous statement) are shown but never imported. */
export type StatementLineKind = 'purchase' | 'fee' | 'payment';

export interface ParsedStatementLine {
  /** Calendar day, `YYYY-MM-DD`. */
  date: string;
  description: string;
  voucher: string | null;
  installmentNumber: number | null;
  installmentCount: number | null;
  currency: StatementCurrency;
  /** Exact integer string in minor units; negative for payments. */
  amount: string;
  kind: StatementLineKind;
}

export interface ParsedStatement {
  closingDate: string;
  dueDate: string;
  /** Last four digits of the card in the statement title, when the file has them. */
  cardEnding: string | null;
  /** The file's "Total a pagar" per currency, minor-unit integer strings. */
  totals: Record<StatementCurrency, string | null>;
  lines: ParsedStatementLine[];
}

export type StatementParseErrorCode =
  | 'tooLarge'
  | 'unreadable'
  | 'unrecognized'
  | 'unrecognizedFormat'
  | 'noTextLayer'
  | 'passwordRequired'
  | 'wrongPassword'
  | 'invalidRow'
  | 'invalidAmount'
  | 'noLines';

export class StatementParseError extends Error {
  constructor(readonly code: StatementParseErrorCode) {
    super(code);
    this.name = 'StatementParseError';
  }
}

/** The password of an encrypted file; it lives only for the one parse call and is never stored. */
export interface StatementParseOptions {
  password?: string;
}

/**
 * Turns a statement file into its lines. There is one parser per file type (`.xlsx`, `.pdf`) and
 * the screen picks one by the file type.
 */
export interface StatementParser {
  /** The `accept` attribute of the file input. */
  readonly accept: string;
  parse(file: File, options?: StatementParseOptions): Promise<ParsedStatement>;
}
