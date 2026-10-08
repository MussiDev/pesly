import type { InstallmentCurrency } from '@pesly/shared';
import type { AccessScope } from '../../../shared/access';
import type {
  InstallmentPurchase,
  InstallmentRow,
  PlannedInstallment,
} from '../../domain/installment';

export interface NewInstallmentPurchase {
  cardId: string;
  categoryId: string;
  totalAmount: bigint;
  currency: InstallmentCurrency;
  purchasedOn: string;
  note: string | null;
  installments: readonly PlannedInstallment[];
}

export interface InstallmentPurchaseChange {
  categoryId?: string;
  note?: string | null;
}

/**
 * Installment purchases and their installments. Every method filters by the scope in the same
 * statement; a card or purchase that is missing or not the caller's reads as `null`, an empty list
 * or `false`.
 */
export interface InstallmentRepository {
  /** Stores the purchase and all its installments atomically. */
  create(scope: AccessScope<'write'>, data: NewInstallmentPurchase): Promise<InstallmentPurchase>;
  /** The card's purchases that were not cancelled, newest first. */
  listPurchases(scope: AccessScope, cardId: string): Promise<InstallmentPurchase[]>;
  /** `null` when the purchase is missing, cancelled or not the caller's. */
  findPurchase(
    scope: AccessScope,
    cardId: string,
    purchaseId: string,
  ): Promise<InstallmentPurchase | null>;
  updatePurchase(
    scope: AccessScope<'write'>,
    cardId: string,
    purchaseId: string,
    change: InstallmentPurchaseChange,
  ): Promise<InstallmentPurchase | null>;
  /**
   * Deletes the installments with those numbers, then the purchase when none is left, or marks it
   * cancelled when some remain (spec D5). `false` when the purchase is missing or cancelled.
   */
  removeInstallments(
    scope: AccessScope<'write'>,
    cardId: string,
    purchaseId: string,
    numbers: readonly number[],
  ): Promise<boolean>;
  /** Every installment of the card, or of all the caller's cards, cancelled purchases included. */
  listRows(scope: AccessScope, cardId?: string): Promise<InstallmentRow[]>;
  /** Whether the card has any purchase, cancelled ones included. */
  cardHasPurchases(scope: AccessScope, cardId: string): Promise<boolean>;
}
