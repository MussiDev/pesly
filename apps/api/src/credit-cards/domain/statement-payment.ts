import { RATE_SCALE, type PaymentStatus } from '@pesly/shared';
import type { StatementTotals } from './statement-assignment';

export type Currency = 'ARS' | 'USD';

export interface CurrencyPaymentView {
  paid: bigint;
  status: PaymentStatus;
}

/** Paid amount and status per currency of a closed statement (spec D1, D3). */
export interface StatementPaymentView {
  ARS: CurrencyPaymentView;
  USD: CurrencyPaymentView;
}

interface ClosedStatement {
  id: string;
  totals: StatementTotals;
}

/**
 * `paid` when the payments cover the total (a total of 0 is covered), `partially_paid` when they
 * cover part of it, `unpaid` when there are none (spec D3).
 */
export function paymentStatus(total: bigint, paid: bigint): PaymentStatus {
  if (paid >= total) return 'paid';
  return paid > 0n ? 'partially_paid' : 'unpaid';
}

function allocate(total: bigint, remaining: bigint): { paid: bigint; left: bigint } {
  const paid = remaining < total ? remaining : total;
  return { paid, left: remaining - paid };
}

/**
 * Allocates what the card received to its closed statements, oldest first and per currency, each
 * taking at most its total (spec D1). An amount beyond every total is a credit and is not
 * allocated; the caller passes the statements already ordered by closing date.
 */
export function allocatePayments(
  closedStatements: readonly ClosedStatement[],
  received: StatementTotals,
): Map<string, StatementPaymentView> {
  let remainingArs = received.ARS;
  let remainingUsd = received.USD;
  const views = new Map<string, StatementPaymentView>();
  for (const statement of closedStatements) {
    const ars = allocate(statement.totals.ARS, remainingArs);
    const usd = allocate(statement.totals.USD, remainingUsd);
    remainingArs = ars.left;
    remainingUsd = usd.left;
    views.set(statement.id, {
      ARS: { paid: ars.paid, status: paymentStatus(statement.totals.ARS, ars.paid) },
      USD: { paid: usd.paid, status: paymentStatus(statement.totals.USD, usd.paid) },
    });
  }
  return views;
}

/**
 * Pesos debited for a USD amount at a rate scaled by 10,000, in minor units, rounded half-up. Both
 * amounts have two decimals, so the scale of the rate is the only one to remove.
 */
export function pesosForRate(usdMinor: bigint, rate: bigint): bigint {
  return (usdMinor * rate + RATE_SCALE / 2n) / RATE_SCALE;
}
