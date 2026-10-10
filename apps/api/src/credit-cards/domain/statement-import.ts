import { MOVEMENT_NOTE_MAX_LENGTH, previousPeriod } from '@pesly/shared';

/** The fields of an imported line that tell one purchase from another. */
export interface ImportedLineIdentity {
  date: string;
  description: string;
  voucher: string | null;
  currency: 'ARS' | 'USD';
  amount: bigint;
  installmentNumber: number | null;
  installmentCount: number | null;
}

function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The key that makes an import idempotent (its SHA-256 is the stored fingerprint): the line's date, normalized description,
 * voucher, currency, amount and installment N/M, plus the occurrence index of identical lines in
 * the same file, so two equal purchases of one day stay two lines instead of collapsing.
 */
export function lineKey(line: ImportedLineIdentity, occurrence: number): string {
  const key = JSON.stringify([
    line.date,
    normalizeText(line.description),
    line.voucher === null ? '' : normalizeText(line.voucher),
    line.currency,
    String(line.amount),
    line.installmentNumber,
    line.installmentCount,
    occurrence,
  ]);
  return key;
}

/** Keys of the lines of one file, in order; identical lines get increasing occurrences. */
export function lineKeys(lines: readonly ImportedLineIdentity[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const base = lineKey(line, 0);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return occurrence === 0 ? base : lineKey(line, occurrence);
  });
}

const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;

/** A statement description as a movement note: no control characters, trimmed, within the limit. */
export function noteFromDescription(description: string): string | undefined {
  const clean = description
    .normalize('NFC')
    .replace(CONTROL_OR_FORMAT, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const note = Array.from(clean).slice(0, MOVEMENT_NOTE_MAX_LENGTH).join('').trim();
  return note === '' ? undefined : note;
}

/**
 * The period of installment 1 of a purchase whose installment `number` is on the statement of
 * `period`: `number - 1` months earlier.
 */
export function firstPeriodOfInstallment(period: string, number: number): string {
  let first = period;
  for (let step = 1; step < number; step += 1) first = previousPeriod(first);
  return first;
}
