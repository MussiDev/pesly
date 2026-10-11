import type { RateType } from '@pesly/shared';

/** Reads the stored rates only; it never calls a provider (spec D8, D18). */
export interface RateReader {
  /** ARS per USD scaled by 10,000; `null` when none is stored for the type. */
  latestSell(rateType: RateType): Promise<{ sell: bigint } | null>;
}
