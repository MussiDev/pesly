import type { RateType } from '@pesly/shared';

export interface NetWorthRateReader {
  /**
   * The sell rate (scaled by 10,000) of `rateType` for each date, or null when there is none. A
   * date before `today` reads the latest history row on or before it; `today` reads the stored
   * current rate. Every requested date is a key of the result.
   */
  sellRates(
    rateType: RateType,
    dates: readonly string[],
    today: string,
  ): Promise<Map<string, bigint | null>>;
}
