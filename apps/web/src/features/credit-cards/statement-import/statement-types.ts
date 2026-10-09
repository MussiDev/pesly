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
  'tooLarge' | 'unreadable' | 'unrecognized' | 'invalidRow' | 'invalidAmount' | 'noLines';

export class StatementParseError extends Error {
  constructor(readonly code: StatementParseErrorCode) {
    super(code);
    this.name = 'StatementParseError';
  }
}

/**
 * Turns a statement file into its lines. The `.xlsx` parser is the only one today; a PDF parser
 * only has to implement this interface.
 */
export interface StatementParser {
  /** The `accept` attribute of the file input. */
  readonly accept: string;
  parse(file: File): Promise<ParsedStatement>;
}
