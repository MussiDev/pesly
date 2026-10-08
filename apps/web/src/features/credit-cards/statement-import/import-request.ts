import {
  STATEMENT_IMPORT_MAX_LINES,
  type CreateStatementImportRequest,
  type StatementImportLine,
} from '@pesly/shared';
import type { ParsedStatement, ParsedStatementLine, StatementCurrency } from './statement-types';

/** The lines the import would upload: purchases always, fees when asked, payments never. */
export function selectedLines(
  statement: ParsedStatement,
  includeFees: boolean,
): ParsedStatementLine[] {
  return statement.lines.filter(
    (line) => line.kind === 'purchase' || (line.kind === 'fee' && includeFees),
  );
}

export interface Reconciliation {
  currency: StatementCurrency;
  /** Sum of the selected lines, minor units. */
  sum: bigint;
  /** The file's "Total a pagar", or `null` when the file has none in this currency. */
  total: bigint | null;
  matches: boolean;
}

/** Compares the selected lines with the statement total per currency; a difference only warns. */
export function reconcile(statement: ParsedStatement, includeFees: boolean): Reconciliation[] {
  const lines = selectedLines(statement, includeFees);
  return (['ARS', 'USD'] as const).flatMap((currency) => {
    const sum = lines
      .filter((line) => line.currency === currency)
      .reduce((total, line) => total + BigInt(line.amount), 0n);
    const raw = statement.totals[currency];
    const total = raw === null ? null : BigInt(raw);
    if (total === null && sum === 0n) return [];
    return [{ currency, sum, total, matches: total !== null && total === sum }];
  });
}

export function tooManyLines(statement: ParsedStatement, includeFees: boolean): boolean {
  return selectedLines(statement, includeFees).length > STATEMENT_IMPORT_MAX_LINES;
}

/** The request for the selected lines, with the one category chosen for the whole import. */
export function buildStatementImportRequest(
  statement: ParsedStatement,
  options: { includeFees: boolean; categoryId: string },
): CreateStatementImportRequest {
  return {
    closingDate: statement.closingDate,
    categoryId: options.categoryId,
    lines: selectedLines(statement, options.includeFees).map((line): StatementImportLine => ({
      date: line.date,
      description: line.description,
      voucher: line.voucher,
      currency: line.currency,
      amount: line.amount,
      installmentNumber: line.installmentNumber,
      installmentCount: line.installmentCount,
      kind: line.kind === 'fee' ? 'fee' : 'purchase',
    })),
  };
}
