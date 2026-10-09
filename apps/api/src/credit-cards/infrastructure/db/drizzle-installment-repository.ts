import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type {
  InstallmentPurchaseChange,
  InstallmentRepository,
  NewInstallmentPurchase,
} from '../../application/ports/installment-repository';
import type {
  InstallmentPurchase,
  InstallmentRow,
  PlannedInstallment,
} from '../../domain/installment';
import { installmentPurchases, installments } from './schema';

const purchaseColumns = {
  id: installmentPurchases.id,
  cardId: installmentPurchases.cardId,
  categoryId: installmentPurchases.categoryId,
  totalAmount: installmentPurchases.totalAmount,
  currency: installmentPurchases.currency,
  installmentCount: installmentPurchases.installmentCount,
  purchasedOn: installmentPurchases.purchasedOn,
  note: installmentPurchases.note,
  createdAt: installmentPurchases.createdAt,
};

type PurchaseRecord = Omit<InstallmentPurchase, 'installments'>;

const ownPurchases = (scope: AccessScope, cardId: string) =>
  and(
    eq(installmentPurchases.cardId, cardId),
    scopedTo(scope, { owner: installmentPurchases.ownerId }),
  );

const activePurchase = (scope: AccessScope, cardId: string, purchaseId: string) =>
  and(
    ownPurchases(scope, cardId),
    eq(installmentPurchases.id, purchaseId),
    isNull(installmentPurchases.cancelledAt),
  );

export class DrizzleInstallmentRepository implements InstallmentRepository {
  constructor(private readonly db: Database) {}

  /** The installments of purchases the caller already read under its scope. */
  private async withInstallments(records: PurchaseRecord[]): Promise<InstallmentPurchase[]> {
    if (records.length === 0) return [];
    const rows = await this.db
      .select({
        purchaseId: installments.purchaseId,
        number: installments.number,
        period: installments.period,
        amount: installments.amount,
      })
      .from(installments)
      .where(
        inArray(
          installments.purchaseId,
          records.map((record) => record.id),
        ),
      )
      .orderBy(asc(installments.purchaseId), asc(installments.number));
    const grouped = new Map<string, PlannedInstallment[]>();
    for (const { purchaseId, ...installment } of rows) {
      const list = grouped.get(purchaseId) ?? [];
      list.push(installment);
      grouped.set(purchaseId, list);
    }
    return records.map((record) => ({ ...record, installments: grouped.get(record.id) ?? [] }));
  }

  async create(
    scope: AccessScope<'write'>,
    data: NewInstallmentPurchase,
  ): Promise<InstallmentPurchase> {
    return this.db.transaction(async (tx) => {
      const [purchase] = await tx
        .insert(installmentPurchases)
        .values({
          ownerId: scope.userId,
          cardId: data.cardId,
          categoryId: data.categoryId,
          totalAmount: data.totalAmount,
          currency: data.currency,
          installmentCount: data.installments.length,
          purchasedOn: data.purchasedOn,
          note: data.note,
        })
        .returning(purchaseColumns);
      if (!purchase) throw new Error('Inserting an installment purchase returned no row');
      await tx.insert(installments).values(
        data.installments.map((installment) => ({
          purchaseId: purchase.id,
          ownerId: scope.userId,
          ...installment,
        })),
      );
      return { ...purchase, installments: [...data.installments] };
    });
  }

  async listPurchases(scope: AccessScope, cardId: string): Promise<InstallmentPurchase[]> {
    const records = await this.db
      .select(purchaseColumns)
      .from(installmentPurchases)
      .where(and(ownPurchases(scope, cardId), isNull(installmentPurchases.cancelledAt)))
      .orderBy(desc(installmentPurchases.purchasedOn), desc(installmentPurchases.createdAt));
    return this.withInstallments(records);
  }

  async findPurchase(
    scope: AccessScope,
    cardId: string,
    purchaseId: string,
  ): Promise<InstallmentPurchase | null> {
    const records = await this.db
      .select(purchaseColumns)
      .from(installmentPurchases)
      .where(activePurchase(scope, cardId, purchaseId))
      .limit(1);
    return (await this.withInstallments(records))[0] ?? null;
  }

  async updatePurchase(
    scope: AccessScope<'write'>,
    cardId: string,
    purchaseId: string,
    change: InstallmentPurchaseChange,
  ): Promise<InstallmentPurchase | null> {
    const records = await this.db
      .update(installmentPurchases)
      .set({
        ...(change.categoryId === undefined ? {} : { categoryId: change.categoryId }),
        ...(change.note === undefined ? {} : { note: change.note }),
        updatedAt: new Date(),
      })
      .where(activePurchase(scope, cardId, purchaseId))
      .returning(purchaseColumns);
    return (await this.withInstallments(records))[0] ?? null;
  }

  async removeInstallments(
    scope: AccessScope<'write'>,
    cardId: string,
    purchaseId: string,
    numbers: readonly number[],
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [purchase] = await tx
        .select({ id: installmentPurchases.id })
        .from(installmentPurchases)
        .where(activePurchase(scope, cardId, purchaseId))
        .for('update')
        .limit(1);
      if (!purchase) return false;
      if (numbers.length > 0) {
        await tx
          .delete(installments)
          .where(
            and(
              eq(installments.purchaseId, purchase.id),
              inArray(installments.number, [...numbers]),
            ),
          );
      }
      const [counted] = await tx
        .select({ remaining: sql<number>`count(*)::int` })
        .from(installments)
        .where(eq(installments.purchaseId, purchase.id));
      if ((counted?.remaining ?? 0) === 0) {
        await tx.delete(installmentPurchases).where(eq(installmentPurchases.id, purchase.id));
      } else {
        await tx
          .update(installmentPurchases)
          .set({ cancelledAt: new Date(), updatedAt: new Date() })
          .where(eq(installmentPurchases.id, purchase.id));
      }
      return true;
    });
  }

  listRows(scope: AccessScope, cardId?: string): Promise<InstallmentRow[]> {
    return this.db
      .select({
        cardId: installmentPurchases.cardId,
        purchaseId: installments.purchaseId,
        number: installments.number,
        count: installmentPurchases.installmentCount,
        period: installments.period,
        amount: installments.amount,
        currency: installmentPurchases.currency,
        categoryId: installmentPurchases.categoryId,
      })
      .from(installments)
      .innerJoin(installmentPurchases, eq(installmentPurchases.id, installments.purchaseId))
      .where(
        and(
          scopedTo(scope, { owner: installmentPurchases.ownerId }),
          cardId === undefined ? undefined : eq(installmentPurchases.cardId, cardId),
        ),
      )
      .orderBy(
        asc(installmentPurchases.createdAt),
        asc(installments.purchaseId),
        asc(installments.number),
      );
  }

  async cardHasPurchases(scope: AccessScope, cardId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(installmentPurchases)
      .where(ownPurchases(scope, cardId))
      .limit(1);
    return row !== undefined;
  }
}
