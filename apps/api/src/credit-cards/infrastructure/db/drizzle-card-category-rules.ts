import type { CardCategoryRule } from '@pesly/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import type { CardCategoryRules } from '../../application/ports/card-category-rules';
import { cardCategoryRules } from './schema';

export class DrizzleCardCategoryRules implements CardCategoryRules {
  constructor(private readonly db: Database) {}

  async list(scope: AccessScope): Promise<CardCategoryRule[]> {
    return this.db
      .select({
        merchantKey: cardCategoryRules.merchantKey,
        categoryId: cardCategoryRules.categoryId,
      })
      .from(cardCategoryRules)
      .where(eq(cardCategoryRules.ownerId, scope.userId))
      .orderBy(asc(cardCategoryRules.merchantKey));
  }

  async learn(scope: AccessScope<'write'>, rules: readonly CardCategoryRule[]): Promise<void> {
    if (rules.length === 0) return;
    await this.db
      .insert(cardCategoryRules)
      .values(
        rules.map((rule) => ({
          ownerId: scope.userId,
          merchantKey: rule.merchantKey,
          categoryId: rule.categoryId,
        })),
      )
      .onConflictDoUpdate({
        target: [cardCategoryRules.ownerId, cardCategoryRules.merchantKey],
        set: { categoryId: sql`excluded.category_id`, updatedAt: sql`now()` },
      });
  }
}
