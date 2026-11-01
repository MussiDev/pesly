import {
  STATEMENT_IMPORT_MAX_LINES,
  suggestCategory,
  type CardCategoryRule,
  type CategorySuggestion,
  type CreateStatementImportRequest,
  type StatementImportLine,
  type SuggestableCategory,
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

/** The category chosen for each line, by its index in `statement.lines`; absent means "general". */
export type LineCategories = ReadonlyMap<number, string>;

/** The suggestion of each line of the statement, by index (FEAT-016); lines with none are absent. */
export function suggestLineCategories(
  statement: ParsedStatement,
  rules: readonly CardCategoryRule[],
  categories: readonly SuggestableCategory[],
): Map<number, CategorySuggestion> {
  const byMerchant = new Map(rules.map((rule) => [rule.merchantKey, rule.categoryId]));
  const suggestions = new Map<number, CategorySuggestion>();
  statement.lines.forEach((line, index) => {
    const suggestion = suggestCategory(line, byMerchant, categories);
    if (suggestion !== null) suggestions.set(index, suggestion);
  });
  return suggestions;
}

/** Whether a selected line has no category of its own, so the general category is needed. */
export function needsGeneralCategory(
  statement: ParsedStatement,
  includeFees: boolean,
  lineCategories: LineCategories,
): boolean {
  const selected = new Set(selectedLines(statement, includeFees));
  return statement.lines.some((line, index) => selected.has(line) && !lineCategories.has(index));
}

/**
 * The request for the selected lines: each line with its own category when it has one, and the
 * general category (when chosen) for the rest.
 */
export function buildStatementImportRequest(
  statement: ParsedStatement,
  options: { includeFees: boolean; categoryId: string; lineCategories?: LineCategories },
): CreateStatementImportRequest {
  const selected = new Set(selectedLines(statement, options.includeFees));
  const lineCategories = options.lineCategories ?? new Map<number, string>();
  return {
    closingDate: statement.closingDate,
    dueDate: statement.dueDate,
    ...(options.categoryId === '' ? {} : { categoryId: options.categoryId }),
    lines: statement.lines.flatMap((line, index): StatementImportLine[] => {
      if (!selected.has(line)) return [];
      const categoryId = lineCategories.get(index);
      return [
        {
          date: line.date,
          description: line.description,
          voucher: line.voucher,
          currency: line.currency,
          amount: line.amount,
          installmentNumber: line.installmentNumber,
          installmentCount: line.installmentCount,
          kind: line.kind === 'fee' ? 'fee' : 'purchase',
          ...(categoryId === undefined ? {} : { categoryId }),
        },
      ];
    }),
  };
}
