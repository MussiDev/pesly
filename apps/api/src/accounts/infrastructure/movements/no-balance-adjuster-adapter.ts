import type { BalanceAdjuster } from '../../application/ports/balance-adjuster';

/**
 * Default when the composition root wires no adjuster: balance changes cannot be recorded, so it
 * fails loudly instead of answering as if the balance had been set.
 */
export class NoBalanceAdjusterAdapter implements BalanceAdjuster {
  adjust(): Promise<never> {
    return Promise.reject(new Error('No balance adjuster is configured'));
  }
}
