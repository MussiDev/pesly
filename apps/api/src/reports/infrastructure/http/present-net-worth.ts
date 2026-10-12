import type { NetWorthResponse } from '@pesly/shared';
import type { NetWorthResult } from '../../application/get-net-worth';

/** Bigints leave the module as integer strings. */
export function presentNetWorth(result: NetWorthResult): NetWorthResponse {
  return {
    currency: result.currency,
    from: result.from,
    to: result.to,
    points: result.points.map((point) => ({
      date: point.date,
      ars: point.ars.toString(),
      usd: point.usd.toString(),
      total: point.total === null ? null : point.total.toString(),
      reason: point.reason,
      investmentsIncomplete: point.investmentsIncomplete,
    })),
  };
}
