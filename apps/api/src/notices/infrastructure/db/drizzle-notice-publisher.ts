import type {
  NoticePublisher,
  PublishNoticeInput,
} from '../../../recurring/application/ports/notice-publisher';
import type { Database } from '../../../shared/db/client';
import type { NewNotice } from '../../domain/notice';
import { renderNoticeText } from '../../domain/notice-text';
import { notices } from './schema';

const conflictTarget = [notices.kind, notices.paymentId, notices.dueDate];

function toNewNotice(input: PublishNoticeInput): NewNotice {
  return {
    ownerId: input.ownerId,
    kind: input.kind,
    paymentId: input.paymentId,
    dueDate: input.dueDate,
    text: renderNoticeText({
      kind: input.kind,
      language: input.language,
      paymentName: input.paymentName,
      dueDate: input.dueDate,
      ...(input.daysUntilDue === undefined ? {} : { daysUntilDue: input.daysUntilDue }),
    }),
  };
}

/**
 * System path: not scoped by a request, the owner comes from the database. A duplicate (kind,
 * payment, due date) is a normal outcome; every other storage error propagates.
 */
export class DrizzleNoticePublisher implements NoticePublisher {
  constructor(private readonly db: Database) {}

  async publish(input: PublishNoticeInput): Promise<boolean> {
    const rows = await this.db
      .insert(notices)
      .values(toNewNotice(input))
      .onConflictDoNothing({ target: conflictTarget })
      .returning({ id: notices.id });
    return rows.length > 0;
  }

  async publishMany(inputs: readonly PublishNoticeInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const rows = await this.db
      .insert(notices)
      .values(inputs.map(toNewNotice))
      .onConflictDoNothing({ target: conflictTarget })
      .returning({ id: notices.id });
    return rows.length;
  }
}
