import { LINKED_ACCOUNT_SUFFIXES, type StatementStatus } from '@pesly/shared';
import type { StatementInstallmentView } from './installment';
import type { StatementTotals } from './statement-assignment';
import type { StatementPaymentView } from './statement-payment';

/** The bank account a card is paid from automatically; `linkedOn` is the owner's local date at link time. */
export interface DebitLink {
  accountId: string;
  linkedOn: string;
}

export interface CreditCard {
  id: string;
  name: string;
  closingDay: number;
  dueDay: number;
  arsAccountId: string;
  usdAccountId: string;
  /** Automatic debit account per currency; `null` means no automatic debit in that currency. */
  debitAccounts: { ARS: DebitLink | null; USD: DebitLink | null };
  createdAt: Date;
}

/** One monthly cycle of a card; `period` is the cycle's month, `YYYY-MM`. */
export interface StatementDraft {
  period: string;
  closingDate: string;
  dueDate: string;
}

export interface Statement extends StatementDraft {
  id: string;
  cardId: string;
}

/** A statement with its status (FR-07) and the totals of its purchases (FR-03), both derived on read. */
export interface StatementView extends Statement {
  status: StatementStatus;
  totals: StatementTotals;
  installments: StatementInstallmentView[];
  /** Paid amount and status per currency; `null` while the statement is open (spec D3). */
  payments: StatementPaymentView | null;
}

/** "<card name> ARS" and "<card name> USD" (FR-02). */
export function linkedAccountNames(cardName: string): { ARS: string; USD: string } {
  return {
    ARS: `${cardName}${LINKED_ACCOUNT_SUFFIXES.ARS}`,
    USD: `${cardName}${LINKED_ACCOUNT_SUFFIXES.USD}`,
  };
}
