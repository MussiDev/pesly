import type { StatementReminderPublisher } from '../credit-cards/application/ports/statement-reminder-publisher';
import type { NoticePublisher } from '../recurring/application/ports/notice-publisher';
import type { Database } from '../shared/db/client';
import { renderNoticeText, type NoticeLanguage } from './domain/notice-text';

export { renderGroupNoticeText, type GroupNoticeTextInput } from './domain/notice-text';
import { DrizzleNoticePublisher } from './infrastructure/db/drizzle-notice-publisher';
import { DrizzleStatementReminderPublisher } from './infrastructure/db/drizzle-statement-reminder-publisher';

export { createNoticesRoutes } from './infrastructure/http/notices-routes';

export interface BudgetAlertTextInput {
  language: NoticeLanguage;
  budgetName: string;
  threshold: number;
  /** Any date of the month; the first day of it is the notice due date. */
  month: string;
}

/** Text of a budget alert notice (DISC-001-06d); takes no amount and no account name. */
export function renderBudgetAlertText(input: BudgetAlertTextInput): string {
  return renderNoticeText({
    kind: 'budget_alert',
    language: input.language,
    subjectName: input.budgetName,
    threshold: input.threshold,
    dueDate: `${input.month.slice(0, 7)}-01`,
  });
}

/**
 * The system-side publisher used by the recurring jobs. It is deliberately separate from the
 * routes: no HTTP request can reach it.
 */
export function createNoticePublisher(db: Database): NoticePublisher {
  return new DrizzleNoticePublisher(db);
}

/** The system-side publisher of the credit card statement reminders (DISC-001-10f); worker only. */
export function createStatementReminderPublisher(db: Database): StatementReminderPublisher {
  return new DrizzleStatementReminderPublisher(db);
}
