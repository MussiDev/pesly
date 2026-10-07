import { eq, sql } from 'drizzle-orm';
import type { CategoryUsage } from '../../../categories/application/ports/category-usage';
import type { Database } from '../../../shared/db/client';
import { installmentPurchases } from './schema';

/** UNSCOPED BY DESIGN (see the port): it only answers for the id it is given. */
export class DrizzleInstallmentCategoryUsage implements CategoryUsage {
  constructor(private readonly db: Database) {}

  async isUsed(categoryId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(installmentPurchases)
      .where(eq(installmentPurchases.categoryId, categoryId))
      .limit(1);
    return row !== undefined;
  }
}

export function createInstallmentCategoryUsage(db: Database): CategoryUsage {
  return new DrizzleInstallmentCategoryUsage(db);
}
