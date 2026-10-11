import { eq } from 'drizzle-orm';
import type { AccessScope } from '../../../shared/access';
import type { Database } from '../../../shared/db/client';
import type { AlertCrossing, BudgetAlertStore } from '../../application/ports/budget-alert-store';
import { notices, users } from './foreign-relations';
import { budgetAlertMarks } from './schema';

export interface BudgetAlertTextParams {
  language: 'es' | 'en';
  budgetName: string;
  threshold: number;
  month: string;
}

/** Renders the stored notice text; injected so this module does not import the notices domain. */
export type RenderAlertText = (input: BudgetAlertTextParams) => string;

/**
 * Marks and notices in one transaction. The unique key of the marks decides who publishes: only
 * the insert that returns a row creates the notice, so concurrent saves cannot alert twice.
 */
export class DrizzleBudgetAlertStore implements BudgetAlertStore {
  constructor(
    private readonly db: Database,
    private readonly renderText: RenderAlertText,
  ) {}

  async publish(scope: AccessScope, crossings: readonly AlertCrossing[]): Promise<number> {
    if (crossings.length === 0) return 0;
    return this.db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ language: users.language })
        .from(users)
        .where(eq(users.id, scope.userId))
        .limit(1);
      if (!owner) throw new Error('Alert requested for a user that does not exist');

      const marks = await tx
        .insert(budgetAlertMarks)
        .values(
          crossings.map((crossing) => ({
            budgetId: crossing.budgetId,
            ownerId: scope.userId,
            month: crossing.month,
            threshold: crossing.threshold,
          })),
        )
        .onConflictDoNothing({
          target: [budgetAlertMarks.budgetId, budgetAlertMarks.month, budgetAlertMarks.threshold],
        })
        .returning({
          id: budgetAlertMarks.id,
          budgetId: budgetAlertMarks.budgetId,
          month: budgetAlertMarks.month,
          threshold: budgetAlertMarks.threshold,
        });
      if (marks.length === 0) return 0;

      const nameOf = new Map(crossings.map((crossing) => [crossing.budgetId, crossing.budgetName]));
      const created = await tx
        .insert(notices)
        .values(
          marks.map((mark) => ({
            ownerId: scope.userId,
            kind: 'budget_alert' as const,
            paymentId: mark.id,
            dueDate: mark.month,
            text: this.renderText({
              language: owner.language,
              budgetName: nameOf.get(mark.budgetId) ?? '',
              threshold: mark.threshold,
              month: mark.month,
            }),
          })),
        )
        .onConflictDoNothing({ target: [notices.kind, notices.paymentId, notices.dueDate] })
        .returning({ id: notices.id });
      return created.length;
    });
  }
}
