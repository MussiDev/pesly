import type { AccessScope } from '../../../shared/access';
import type {
  CardPurchaseFlowRow,
  FlowWindow,
  InstallmentFlowRow,
  PersonalFlowRow,
  ShareFlowRow,
} from './flow-reader';

/** One movement of the category: a row of the flows with a single movement in it. */
export interface PersonalItemRow extends Omit<PersonalFlowRow, 'month'> {
  movementId: string;
  /** `YYYY-MM-DD` in the window's zone. */
  day: string;
  note: string | null;
  categoryId: string;
  categoryName: string | null;
  categoryDefaultKey: string | null;
}

export interface CardPurchaseItemRow extends CardPurchaseFlowRow {
  movementId: string;
  day: string;
  note: string | null;
  categoryId: string;
  categoryName: string | null;
  categoryDefaultKey: string | null;
}

export interface InstallmentItemRow extends InstallmentFlowRow {
  purchaseId: string;
  cardId: string;
  number: number;
  installmentCount: number;
  /** The purchase day. */
  day: string;
  note: string | null;
  categoryId: string;
  categoryName: string | null;
  categoryDefaultKey: string | null;
}

export interface ShareItemRow extends ShareFlowRow {
  expenseId: string;
  /** Grouping key of the flows: the group category. */
  groupCategoryId: string;
  groupId: string;
  groupName: string;
  day: string;
  description: string;
}

/**
 * The flows of `FlowReader` one item per row (`count` is 1), so the category detail lists what
 * the dashboard adds up. Personal, card and installment reads are narrowed to one top-level
 * category; a share is matched to a category by name, so every share of the window is read.
 */
export interface CategoryItemReader {
  personalItems(
    scope: AccessScope,
    window: FlowWindow,
    topCategoryId: string,
  ): Promise<PersonalItemRow[]>;
  cardPurchaseItems(
    scope: AccessScope,
    periodFrom: string,
    periodTo: string,
    options: { timeZone: string; topCategoryId: string },
  ): Promise<CardPurchaseItemRow[]>;
  installmentItems(
    scope: AccessScope,
    periodFrom: string,
    periodTo: string,
    topCategoryId: string,
  ): Promise<InstallmentItemRow[]>;
  shareItems(scope: AccessScope, window: FlowWindow): Promise<ShareItemRow[]>;
}
