import type { CategorizedMovementType, MovementRateSource, RateType } from '@pesly/shared';

export type { MovementRateSource };

interface MovementBase {
  id: string;
  ownerId: string;
  /** The source account of a transfer or exchange. */
  accountId: string;
  /** Positive minor units of the source account's currency. */
  amount: bigint;
  occurredAt: Date;
  note: string | null;
  createdAt: Date;
}

/** An expense or income: a category and a rate frozen when the movement is recorded. */
export interface CategorizedMovement extends MovementBase {
  type: CategorizedMovementType;
  categoryId: string;
  /** ARS per USD scaled by 10,000. */
  rate: bigint;
  rateSource: Exclude<MovementRateSource, 'implied'>;
  /** The rate type of an automatic rate; `null` for a manual one. */
  rateType: RateType | null;
}

/** Money moved between two accounts of the same currency; no category, no rate. */
export interface Transfer extends MovementBase {
  type: 'transfer';
  destinationAccountId: string;
  /** Always equal to `amount`. */
  destinationAmount: bigint;
}

/** Money changed between an ARS and a USD account, with the rate implied by the two amounts. */
export interface Exchange extends MovementBase {
  type: 'exchange';
  destinationAccountId: string;
  /** Positive minor units of the destination account's currency. */
  destinationAmount: bigint;
  /** ARS per USD scaled by 10,000, derived from the two amounts. */
  rate: bigint;
  rateSource: 'implied';
  rateType: null;
}

export type Movement = CategorizedMovement | Transfer | Exchange;

/** A plain `Omit` over a union collapses it; this one keeps each member. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What the repository stores; the owner comes from the scope, the id and timestamp from storage. */
export type NewMovement = DistributiveOmit<Movement, 'id' | 'ownerId' | 'createdAt'>;
