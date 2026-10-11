import { BASIS_POINTS_TOTAL } from '@pesly/shared';

const PERCENTAGE_PATTERN = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;

/**
 * Reads typed percentage text (up to 2 decimals, 0 to 100) as integer basis points. Integer string
 * parsing only, so no float is ever created. Returns `null` for anything else.
 */
export function parsePercentageInput(text: string): number | null {
  const match = PERCENTAGE_PATTERN.exec(text.trim());
  if (match === null) return null;
  const [, whole = '', fraction = ''] = match;
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return basisPoints <= BASIS_POINTS_TOTAL ? basisPoints : null;
}
