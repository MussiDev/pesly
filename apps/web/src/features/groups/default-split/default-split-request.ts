import { BASIS_POINTS_TOTAL, type DefaultSplitRequest } from '@pesly/shared';
import { parsePercentageInput } from '../split/percentage-input';

export type DefaultSplitMode = DefaultSplitRequest['mode'];

export interface DefaultSplitFieldError {
  memberId: string;
  /** A catalog path. */
  path: string;
}

export interface BuiltDefaultSplit {
  request?: DefaultSplitRequest;
  errors?: DefaultSplitFieldError[];
  /** Basis points still to assign (`10000 - total`, signed); set only when the total is wrong. */
  difference?: bigint;
}

/**
 * Turns the typed default split into the request. Percentages are read as integer basis points and
 * must total 10000; every member id comes from the loaded `memberIds`.
 */
export function buildDefaultSplitRequest(
  mode: DefaultSplitMode,
  memberIds: readonly string[],
  values: Readonly<Record<string, string>>,
): BuiltDefaultSplit {
  if (mode === 'equal') return { request: { mode: 'equal' } };

  const shares: { memberId: string; basisPoints: number }[] = [];
  const errors: DefaultSplitFieldError[] = [];
  for (const memberId of memberIds) {
    const basisPoints = parsePercentageInput(values[memberId] ?? '');
    if (basisPoints === null) {
      errors.push({ memberId, path: 'groups.split.errors.percentageInvalid' });
    } else shares.push({ memberId, basisPoints });
  }
  if (errors.length > 0) return { errors };

  const difference =
    BigInt(BASIS_POINTS_TOTAL) - shares.reduce((sum, s) => sum + BigInt(s.basisPoints), 0n);
  if (difference !== 0n) return { difference };
  return { request: { mode: 'percentage', shares } };
}

/** Basis points as typed percentage text, e.g. 6050 -> "60.5", using integer arithmetic only. */
export function formatBasisPointsInput(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = String(basisPoints % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${String(whole)}.${fraction}`;
}
