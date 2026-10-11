import type { ReminderLanguage } from './statement-reminder-source';

/** The statement a reminder is about, by the identity of its notice. */
export interface StatementReminderRef {
  statementId: string;
  dueDate: string;
}

export interface StatementReminderInput extends StatementReminderRef {
  ownerId: string;
  cardName: string;
  language: ReminderLanguage;
}

/**
 * Creates the "statement due" notice of a statement. The notices module implements it; this port
 * speaks of statements and never of the storage behind the notice.
 */
export interface StatementReminderPublisher {
  /** The `reminderKey` of every ref of `ownerId` that already has its notice. */
  published(ownerId: string, refs: readonly StatementReminderRef[]): Promise<Set<string>>;
  /** Creates the notices that do not exist yet; returns how many were created. */
  publishMany(inputs: readonly StatementReminderInput[]): Promise<number>;
}
