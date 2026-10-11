import { and, eq, inArray, or } from 'drizzle-orm';
import type {
  StatementReminderInput,
  StatementReminderPublisher,
  StatementReminderRef,
} from '../../../credit-cards/application/ports/statement-reminder-publisher';
import type { Database } from '../../../shared/db/client';
import type { NewNotice } from '../../domain/notice';
import { renderNoticeText } from '../../domain/notice-text';
import { notices } from './schema';

const KIND = 'card_statement_due';
const conflictTarget = [notices.kind, notices.paymentId, notices.dueDate];

/** Same format as the credit-cards `reminderKey`, rebuilt here because notices may import only types from it. */
const keyOf = (statementId: string, dueDate: string): string => `${statementId}|${dueDate}`;

/** `payment_id` carries the statement id: the notice's subject id, with no foreign key. */
function toNewNotice(input: StatementReminderInput): NewNotice {
  return {
    ownerId: input.ownerId,
    kind: KIND,
    paymentId: input.statementId,
    dueDate: input.dueDate,
    text: renderNoticeText({
      kind: KIND,
      language: input.language,
      subjectName: input.cardName,
      dueDate: input.dueDate,
    }),
  };
}

/**
 * System path: not scoped by a request, the owner comes from the database. A duplicate (kind,
 * statement, due date) is a normal outcome; every other storage error propagates.
 */
export class DrizzleStatementReminderPublisher implements StatementReminderPublisher {
  constructor(private readonly db: Database) {}

  async published(ownerId: string, refs: readonly StatementReminderRef[]): Promise<Set<string>> {
    if (refs.length === 0) return new Set();
    const rows = await this.db
      .select({ paymentId: notices.paymentId, dueDate: notices.dueDate })
      .from(notices)
      .where(
        and(
          eq(notices.ownerId, ownerId),
          eq(notices.kind, KIND),
          inArray(notices.paymentId, [...new Set(refs.map((ref) => ref.statementId))]),
          or(...refs.map((ref) => eq(notices.dueDate, ref.dueDate))),
        ),
      );
    const wanted = new Set(refs.map((ref) => keyOf(ref.statementId, ref.dueDate)));
    return new Set(
      rows.map((row) => keyOf(row.paymentId, row.dueDate)).filter((key) => wanted.has(key)),
    );
  }

  async publishMany(inputs: readonly StatementReminderInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const rows = await this.db
      .insert(notices)
      .values(inputs.map(toNewNotice))
      .onConflictDoNothing({ target: conflictTarget })
      .returning({ id: notices.id });
    return rows.length;
  }
}
