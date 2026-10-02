export const PRICE_FAILURE_CODES = [
  'provider_unreachable',
  'provider_timeout',
  'provider_bad_status',
  'provider_rate_limited',
  'provider_invalid_payload',
] as const;

export type PriceFailureCode = (typeof PRICE_FAILURE_CODES)[number];

/**
 * The only error a price provider adapter raises for a provider fault. `detail` is a short
 * free-form item name written by our own code (never provider text); the type does not enforce
 * that, and storage bounds it with the 200-character column check.
 */
export class PriceProviderFailure extends Error {
  readonly code: PriceFailureCode;
  readonly status?: number;
  readonly detail?: string;

  constructor(code: PriceFailureCode, options: { status?: number; detail?: string } = {}) {
    super(code);
    this.name = 'PriceProviderFailure';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.detail !== undefined) this.detail = options.detail;
  }
}
