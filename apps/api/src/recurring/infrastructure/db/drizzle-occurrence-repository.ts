import { and, asc, eq } from 'drizzle-orm';
import { notFoundUnlessAllowed, type AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import type { Database } from '../../../shared/db/client';
import type {
  NewOccurrence,
  OccurrenceRepository,
  OccurrenceResolution,
} from '../../application/ports/occurrence-repository';
import { OccurrenceNotPending } from '../../domain/errors';
import type { RecurringOccurrence } from '../../domain/recurring-payment';
import { recurringOccurrences } from './schema';

const occurrenceColumns = {
  id: recurringOccurrences.id,
  paymentId: recurringOccurrences.paymentId,
  dueDate: recurringOccurrences.dueDate,
  status: recurringOccurrences.status,
  confirmedAmount: recurringOccurrences.confirmedAmount,
  movementId: recurringOccurrences.movementId,
  resolvedAt: recurringOccurrences.resolvedAt,
  createdAt: recurringOccurrences.createdAt,
};

const ownOccurrence = (scope: AccessScope, id: string) =>
  and(eq(recurringOccurrences.id, id), scopedTo(scope, { owner: recurringOccurrences.ownerId }));

export class DrizzleOccurrenceRepository implements OccurrenceRepository {
  constructor(private readonly db: Database) {}

  async insertIgnore(rows: readonly NewOccurrence[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(recurringOccurrences)
      .values(rows.map((row) => ({ ...row })))
      .onConflictDoNothing({
        target: [recurringOccurrences.paymentId, recurringOccurrences.dueDate],
      });
  }

  listPending(scope: AccessScope): Promise<RecurringOccurrence[]> {
    return this.db
      .select(occurrenceColumns)
      .from(recurringOccurrences)
      .where(
        and(
          eq(recurringOccurrences.status, 'pending'),
          scopedTo(scope, { owner: recurringOccurrences.ownerId }),
        ),
      )
      .orderBy(asc(recurringOccurrences.dueDate), asc(recurringOccurrences.id));
  }

  async deletePendingFor(scope: AccessScope<'write'>, paymentId: string): Promise<void> {
    await this.db
      .delete(recurringOccurrences)
      .where(
        and(
          eq(recurringOccurrences.paymentId, paymentId),
          eq(recurringOccurrences.status, 'pending'),
          scopedTo(scope, { owner: recurringOccurrences.ownerId }),
        ),
      );
  }

  withLockedPending(
    scope: AccessScope<'write'>,
    id: string,
    fn: (occurrence: RecurringOccurrence) => Promise<OccurrenceResolution>,
  ): Promise<RecurringOccurrence> {
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select(occurrenceColumns)
        .from(recurringOccurrences)
        .where(ownOccurrence(scope, id))
        .for('update');
      const occurrence = notFoundUnlessAllowed(locked);
      if (occurrence.status !== 'pending') throw new OccurrenceNotPending();

      const resolution = await fn(occurrence);
      const [updated] = await tx
        .update(recurringOccurrences)
        .set({
          status: resolution.status,
          confirmedAmount: resolution.status === 'confirmed' ? resolution.confirmedAmount : null,
          movementId: resolution.status === 'confirmed' ? resolution.movementId : null,
          resolvedAt: new Date(),
        })
        .where(ownOccurrence(scope, id))
        .returning(occurrenceColumns);
      if (!updated) throw new Error('Resolving a locked occurrence returned no row');
      return updated;
    });
  }
}
