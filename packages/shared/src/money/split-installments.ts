/** Installments per purchase: from 2 to 60 (DISC-001-10c FR-01). */
export const INSTALLMENTS_MIN = 2;
export const INSTALLMENTS_MAX = 60;

/**
 * Splits `total` minor units into `count` installments: each gets `total / count` rounded down and
 * the first also gets the units left over (FR-03). The parts always add up to `total` exactly.
 */
export function splitInstallments(total: bigint, count: number): bigint[] {
  if (!Number.isInteger(count) || count < INSTALLMENTS_MIN || count > INSTALLMENTS_MAX) {
    throw new RangeError(
      `Installments must be an integer from ${INSTALLMENTS_MIN} to ${INSTALLMENTS_MAX}`,
    );
  }
  const divisor = BigInt(count);
  if (total < divisor) {
    throw new RangeError('The total must be at least one minor unit per installment');
  }
  const base = total / divisor;
  const parts = Array.from({ length: count }, () => base);
  parts[0] = base + (total % divisor);
  return parts;
}
